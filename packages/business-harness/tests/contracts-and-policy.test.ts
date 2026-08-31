import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentExecutionBundleSchema } from '../src/contracts.js';
import { HarnessError } from '../src/errors.js';
import { enforceRunPolicy, resolveRuntimeProfile } from '../src/profiles.js';
import { makeBundle, makeConfig } from './helpers.js';

test('execution bundle rejects provider secrets and endpoints outside the contract', () => {
  const bundle = makeBundle();
  const withSecret = structuredClone(bundle) as unknown as Record<string, any>;
  withSecret.agent.model.apiKey = 'must-not-be-accepted';
  assert.equal(AgentExecutionBundleSchema.safeParse(withSecret).success, false);
});

test('business profile rejects wildcard tools and excessive limits', () => {
  const config = makeConfig({
    connectors: {
      om: {
        driver: 'mcp-http',
        url: 'http://localhost:3000/mcp',
        credentialAudience: 'om:mcp',
        credentialBindingId: 'om-default',
      },
    },
  });
  const bundle = makeBundle();
  bundle.agent.capabilities = [{ connectorId: 'om', allowedTools: ['*'], access: 'write' }];
  assert.throws(() => enforceRunPolicy(bundle, config), HarnessError);

  bundle.agent.capabilities = [];
  bundle.agent.loop.maxSteps = 13;
  assert.throws(() => enforceRunPolicy(bundle, config), /maxSteps exceeds profile limit/);
});

test('custom profile extends a server-owned profile', () => {
  const config = makeConfig({
    runtimeProfiles: {
      'invoice-v1': { extends: 'business-v1', maxSteps: 3, maxToolCalls: 4 },
    },
  });
  const profile = resolveRuntimeProfile('invoice-v1', config);
  assert.equal(profile.maxSteps, 3);
  assert.equal(profile.maxToolCalls, 4);
  assert.equal(profile.maxTimeoutMs, 120_000);
});

