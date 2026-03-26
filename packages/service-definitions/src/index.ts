/**
 * @orcha/service-definitions
 *
 * Type definitions for orcha service configuration.
 * This package is data-free — all service data comes from orcha.config.yaml
 * via @orcha/config-loader.
 */

export type ServiceKind = 'service' | 'infra' | 'library';
export type RuntimeMode = 'local' | 'remote' | 'mock';
export type VerificationKind = 'health' | 'api' | 'data';

export type CommandSpec = {
  readonly bin: string;
  readonly args: readonly string[];
};

export type ScriptRuntime = {
  readonly type: 'script';
  readonly command: CommandSpec;
  readonly stopCommand?: CommandSpec;
};

export type ComposeRuntime = {
  readonly type: 'compose';
  readonly composeFile: string;
  readonly projectName: string;
  readonly services?: readonly string[];
  readonly upArgs?: readonly string[];
  readonly downArgs?: readonly string[];
};

export type RuntimeAdapter = ScriptRuntime | ComposeRuntime;

export type HealthCheck = {
  readonly name: string;
  readonly url: string;
  readonly expectedStatus?: number;
};

export type VerificationProbe = {
  readonly id: string;
  readonly label: string;
  readonly kind: VerificationKind;
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly expectedStatus: number;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly expectKeys?: readonly string[];
  readonly expectContains?: readonly string[];
  readonly notes?: string;
};

export type ServiceProfile = {
  readonly description?: string;
  readonly env?: Record<string, string>;
  readonly nodeConfig?: Record<string, unknown>;
  readonly dependencies?: readonly string[];
  readonly referenceDeps?: readonly string[];
  readonly healthChecks?: readonly HealthCheck[];
};

export type ServiceDefinition = {
  readonly id: string;
  readonly label: string;
  readonly kind: ServiceKind;
  readonly ownerServiceId?: string;
  readonly repoPath: string;
  readonly workingDirectory: string;
  readonly runtime: RuntimeAdapter;
  readonly localUrl: string;
  readonly healthChecks: readonly HealthCheck[];
  readonly dependencies: readonly string[];
  readonly referenceDeps?: readonly string[];
  readonly runtimeModes: readonly RuntimeMode[];
  readonly env: Record<string, string>;
  readonly nodeConfig: Record<string, unknown>;
  readonly defaultProfile?: string;
  readonly profiles?: Record<string, ServiceProfile>;
  readonly postStartDelayMs?: number;
  readonly postStartCommands?: readonly CommandSpec[];
  readonly postStartRetry?: {
    readonly attempts: number;
    readonly delayMs: number;
  };
  readonly verification: {
    readonly api: readonly VerificationProbe[];
    readonly data: readonly VerificationProbe[];
  };
};

export type ResolvedServiceDefinition = ServiceDefinition & {
  readonly profile: string;
};

export type FlowStep = {
  readonly id: string;
  readonly label: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly expectedStatus: number;
  readonly expectKeys?: readonly string[];
  readonly expectContains?: readonly string[];
  readonly delayBeforeMs?: number;
  readonly captureAs?: string;
};

export type FlowScenarioDefinition = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly requiredServices: readonly string[];
  readonly steps: readonly FlowStep[];
};

export type StackPreset = {
  readonly id: string;
  readonly description: string;
  readonly services: readonly string[];
};

export type SeedFixture = {
  readonly id: string;
  readonly label: string;
  readonly targetService: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly expectedStatus: number;
  readonly dependsOn?: readonly string[];
};

export type ExternalScriptDefinition = {
  readonly id: string;
  readonly label: string;
  readonly serviceId: string;
  readonly command: CommandSpec;
  readonly localUrlArg?: string;
  readonly timeoutMs?: number;
  readonly envBindings?: Record<string, { serviceId: string; property: string }>;
};

export type OrchaConfig = {
  readonly version: number;
  readonly workspace: {
    readonly name: string;
  };
  readonly github?: {
    readonly host: string;
    readonly org: string;
  };
  readonly services: Record<string, ServiceDefinition>;
  readonly aliases?: Record<string, string>;
  readonly presets?: Record<string, StackPreset>;
  readonly fixtures?: readonly SeedFixture[];
  readonly flows?: readonly FlowScenarioDefinition[];
  readonly externalScripts?: readonly ExternalScriptDefinition[];
  readonly defaults?: {
    readonly upTarget?: string;
    readonly verifyApiService?: string;
    readonly verifyDataService?: string;
    readonly verifyFlowScenario?: string;
  };
  readonly onboard?: {
    readonly binaries?: readonly string[];
    readonly skills?: readonly string[];
  };
};
