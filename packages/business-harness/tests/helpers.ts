import { HarnessConfigSchema, type HarnessConfig } from '../src/config.js';
import type { AgentExecutionBundle } from '../src/contracts.js';

export function makeConfig(overrides: Record<string, unknown> = {}): HarnessConfig {
  return HarnessConfigSchema.parse({
    runtimeProfiles: {},
    connectors: {},
    modelPolicy: { allowedOpenAICompatibleOrigins: [] },
    ...overrides,
  });
}

export function makeBundle(overrides: Record<string, unknown> = {}): AgentExecutionBundle {
  const bundle = {
    protocolVersion: '1',
    runId: 'run-123',
    agent: {
      id: 'invoice-reviewer',
      version: '3',
      digest: '0123456789abcdef',
      runtimeProfile: 'business-v1',
      instructions: 'Review the invoice and return a decision.',
      model: {
        bindingId: 'primary-model',
        bindingRevision: '7',
        driver: 'openai',
        modelId: 'gpt-5-mini',
        credentialBindingId: 'openai-primary',
        settings: { maxOutputTokens: 1000 },
      },
      capabilities: [],
      loop: { maxSteps: 5, timeoutMs: 30_000, maxToolCalls: 10 },
      output: { mode: 'object', schema: { type: 'object', properties: {} } },
    },
    input: { prompt: 'Review invoice INV-1', context: { tenantId: 'tenant-1' } },
    authorization: { runGrant: 'run-grant-with-enough-entropy' },
    ...overrides,
  };
  return bundle as AgentExecutionBundle;
}

