#!/usr/bin/env bun

/**
 * @orcha/mcp-server
 *
 * MCP server that exposes workspace context to any MCP-compatible AI agent.
 * Agents get service topology, health status, KB docs, and blast radius
 * analysis without needing Orcha-specific agent skills.
 *
 * Usage:
 *   Add to claude_desktop_config.json or .claude/settings.json:
 *   { "mcpServers": { "orcha": { "command": "bun", "args": ["packages/mcp-server/src/index.ts"] } } }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  loadConfig,
  getServiceDefinition,
  resolveServiceDefinition,
  listAllServiceDefinitions,
  listServiceDefinitions,
  listPresets,
  getPreset,
  listFlowScenarios,
  listFixtures,
  getDefaults,
  getWorkspaceRoot,
} from '@orcha/config-loader';
import { getStartOrder } from '@orcha/orchestrator';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const server = new McpServer({
  name: 'orcha',
  version: '0.1.0',
});

// ---------------------------------------------------------------------------
// Resources: Read-only workspace context
// ---------------------------------------------------------------------------

server.resource(
  'services',
  'orcha://services',
  async (uri) => {
    const services = listAllServiceDefinitions();
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(services.map((s) => ({
          id: s.id,
          label: s.label,
          kind: s.kind,
          localUrl: s.localUrl,
          dependencies: s.dependencies,
          healthChecks: s.healthChecks,
          profiles: s.profiles ? Object.keys(s.profiles) : [],
        })), null, 2),
      }],
    };
  },
);

server.resource(
  'presets',
  'orcha://presets',
  async (uri) => {
    const presets = listPresets();
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(presets, null, 2),
      }],
    };
  },
);

server.resource(
  'topology',
  'orcha://topology',
  async (uri) => {
    const services = listAllServiceDefinitions();
    const topology = services.map((s) => ({
      id: s.id,
      kind: s.kind,
      dependencies: [...s.dependencies],
      referenceDeps: [...(s.referenceDeps ?? [])],
      dependedOnBy: services
        .filter((other) => other.dependencies.includes(s.id))
        .map((other) => other.id),
    }));
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(topology, null, 2),
      }],
    };
  },
);

// ---------------------------------------------------------------------------
// Tools: Actions agents can take
// ---------------------------------------------------------------------------

// @ts-expect-error — MCP SDK type instantiation is excessively deep with complex zod schemas
server.tool(
  'get_service_config',
  'Get the resolved configuration for a service, optionally with a specific profile applied',
  { serviceId: z.string(), profile: z.string().optional() },
  async ({ serviceId, profile }) => {
    try {
      const resolved = resolveServiceDefinition(serviceId, profile);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            id: resolved.id,
            label: resolved.label,
            kind: resolved.kind,
            profile: resolved.profile,
            localUrl: resolved.localUrl,
            runtime: resolved.runtime,
            dependencies: resolved.dependencies,
            healthChecks: resolved.healthChecks,
            env: resolved.env,
            nodeConfig: resolved.nodeConfig,
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

server.tool(
  'get_blast_radius',
  'Analyze what services, probes, and flows would be affected if a service changes or goes down',
  { serviceId: z.string() },
  async ({ serviceId }) => {
    try {
      const allServices = listAllServiceDefinitions();
      const target = getServiceDefinition(serviceId);

      // Direct dependents
      const directDependents = allServices.filter((svc) =>
        svc.dependencies.includes(serviceId),
      ).map((s) => ({ id: s.id, label: s.label, kind: s.kind }));

      // Transitive
      const allDependents = new Set<string>(directDependents.map((s) => s.id));
      let frontier = directDependents.map((s) => s.id);
      while (frontier.length > 0) {
        const next: string[] = [];
        for (const depId of frontier) {
          const transitive = allServices.filter((svc) =>
            svc.dependencies.includes(depId) && !allDependents.has(svc.id),
          );
          for (const t of transitive) {
            allDependents.add(t.id);
            next.push(t.id);
          }
        }
        frontier = next;
      }

      // Affected flows
      const flows = listFlowScenarios();
      const affectedFlows = flows.filter((f) =>
        f.requiredServices.includes(serviceId) ||
        f.requiredServices.some((rs) => allDependents.has(rs)),
      );

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            service: serviceId,
            label: target.label,
            directDependents,
            transitiveDependents: [...allDependents]
              .filter((id) => !directDependents.some((d) => d.id === id))
              .map((id) => { const s = getServiceDefinition(id); return { id: s.id, label: s.label }; }),
            affectedFlows: affectedFlows.map((f) => ({ id: f.id, label: f.label })),
            totalBlastRadius: allDependents.size,
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

server.tool(
  'get_start_order',
  'Get the dependency-resolved startup order for a preset or service',
  { target: z.string(), profile: z.string().optional() },
  async ({ target, profile }) => {
    try {
      const order = getStartOrder(target, profile);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ target, profile: profile ?? 'default', startOrder: order }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

server.tool(
  'search_kb',
  'Search knowledge base documents across all services. Returns matching file paths and snippets.',
  { query: z.string(), serviceId: z.string().optional() },
  async ({ query, serviceId }) => {
    try {
      const config = loadConfig();
      const kbDir = (config.knowledge as any)?.directory ?? path.join(getWorkspaceRoot(), 'knowledge');
      if (!existsSync(kbDir)) {
        return { content: [{ type: 'text' as const, text: 'No knowledge base directory found.' }] };
      }

      const results: Array<{ service: string; file: string; snippet: string }> = [];
      const queryLower = query.toLowerCase();

      const serviceDirs = serviceId ? [serviceId] : (() => {
        try {
          return readdirSync(kbDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
        } catch { return []; }
      })();

      for (const dir of serviceDirs) {
        const svcKbDir = path.join(kbDir, dir);
        if (!existsSync(svcKbDir)) continue;

        const files = readdirSync(svcKbDir).filter((f) => f.endsWith('.md'));
        for (const file of files) {
          const content = readFileSync(path.join(svcKbDir, file), 'utf8');
          if (content.toLowerCase().includes(queryLower)) {
            // Extract a snippet around the match
            const idx = content.toLowerCase().indexOf(queryLower);
            const start = Math.max(0, idx - 100);
            const end = Math.min(content.length, idx + query.length + 100);
            results.push({
              service: dir,
              file,
              snippet: content.slice(start, end).replace(/\n/g, ' ').trim(),
            });
          }
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: results.length > 0
            ? JSON.stringify(results, null, 2)
            : `No KB documents matching "${query}" found.`,
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

server.tool(
  'get_workspace_summary',
  'Get a high-level summary of the workspace: services, presets, defaults, and config location',
  {},
  async () => {
    try {
      const config = loadConfig();
      const services = listAllServiceDefinitions();
      const presets = listPresets();
      const defaults = getDefaults();

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            workspace: config.workspace,
            github: config.github,
            workspaceRoot: getWorkspaceRoot(),
            serviceCount: services.length,
            services: services.map((s) => ({ id: s.id, kind: s.kind })),
            presets: presets.map((p) => ({ id: p.id, services: p.services })),
            defaults,
            flowCount: listFlowScenarios().length,
            fixtureCount: listFixtures().length,
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const main = async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
