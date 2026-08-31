import assert from 'node:assert/strict';
import test from 'node:test';
import type { LanguageModel } from 'ai';
import { CapabilityGateway } from '../src/capabilities/gateway.js';
import type { CredentialResolver } from '../src/credentials/types.js';
import { BusinessAgentRuntime } from '../src/runtime/runtime.js';
import type { AgentEngine } from '../src/runtime/engine.js';
import type { ModelResolver } from '../src/models/resolver.js';
import { makeBundle, makeConfig } from './helpers.js';

test('runtime returns reproducible execution identity and never returns credentials', async () => {
  const config = makeConfig();
  const credentials: CredentialResolver = {
    async resolve() {
      throw new Error('No capability credential should be requested');
    },
  };
  const modelResolver: ModelResolver = {
    async resolve(binding) {
      return {
        model: {} as LanguageModel,
        driver: binding.driver,
        modelId: binding.modelId,
        providerOptions: { openai: { strictJsonSchema: false } },
      };
    },
  };
  let prompt = '';
  let providerOptions: unknown;
  const engine: AgentEngine = {
    async run(request) {
      prompt = request.prompt;
      providerOptions = request.providerOptions;
      return { output: { decision: 'approve' }, usage: { totalTokens: 21 }, steps: 2 };
    },
  };
  const runtime = new BusinessAgentRuntime({
    config,
    modelResolver,
    capabilities: new CapabilityGateway(config, credentials),
    engine,
  });
  const events: string[] = [];
  const result = await runtime.run(makeBundle(), { onEvent: (event) => events.push(event.type) });
  assert.equal(result.identity.agentVersion, '3');
  assert.equal(result.identity.model.bindingRevision, '7');
  assert.match(prompt, /<open_mercato_context>/);
  assert.deepEqual(providerOptions, { openai: { strictJsonSchema: false } });
  assert.equal(JSON.stringify(result).includes('run-grant-with-enough-entropy'), false);
  assert.deepEqual(events, ['run.started', 'capabilities.ready', 'run.completed']);
});
