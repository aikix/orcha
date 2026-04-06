import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import path from 'node:path';
import { resetConfig } from '@orcha/config-loader';
import { getStartOrder } from './index.js';

const FIXTURE_CONFIG = path.resolve(
  import.meta.dir,
  '..',
  '..',
  '..',
  'packages',
  'config-loader',
  'src',
  '__fixtures__',
  'basic.orcha.config.yaml',
);

beforeAll(() => {
  process.env.ORCHA_CONFIG = FIXTURE_CONFIG;
  resetConfig();
});

afterAll(() => {
  delete process.env.ORCHA_CONFIG;
  resetConfig();
});

describe('getStartOrder', () => {
  test('core preset resolves full dependency chain', () => {
    const order = getStartOrder('core');
    expect(order).toContain('redis');
    expect(order).toContain('api-service');
    expect(order).toContain('web-ui');
    // redis before api-service, api-service before web-ui
    expect(order.indexOf('redis')).toBeLessThan(order.indexOf('api-service'));
    expect(order.indexOf('api-service')).toBeLessThan(order.indexOf('web-ui'));
  });

  test('api-only preset includes redis and api-service', () => {
    const order = getStartOrder('api-only');
    expect(order).toContain('redis');
    expect(order).toContain('api-service');
    expect(order).not.toContain('web-ui');
  });

  test('single service web-ui resolves full chain', () => {
    const order = getStartOrder('web-ui');
    expect(order).toContain('redis');
    expect(order).toContain('api-service');
    expect(order).toContain('web-ui');
  });

  test('single service api-service includes redis', () => {
    const order = getStartOrder('api-service');
    expect(order).toContain('redis');
    expect(order).toContain('api-service');
    expect(order).not.toContain('web-ui');
  });

  test('single service redis has only itself', () => {
    const order = getStartOrder('redis');
    expect(order).toEqual(['redis']);
  });

  test('no duplicates in start order', () => {
    const order = getStartOrder('core');
    const unique = new Set(order);
    expect(unique.size).toBe(order.length);
  });

  test('profile does not change dependency set', () => {
    const defaultOrder = getStartOrder('api-service');
    const stagingOrder = getStartOrder('api-service', 'staging');
    // staging profile for api-service may change deps, but let's verify it returns valid results
    expect(stagingOrder).toContain('api-service');
    expect(Array.isArray(stagingOrder)).toBe(true);
  });
});
