import type { LanguageModel, ToolLoopAgentSettings } from 'ai';
import type { ModelBinding } from '../contracts.js';
import type { CredentialResolver } from '../credentials/types.js';
import { HarnessError } from '../errors.js';

export interface ResolveModelOptions {
  runId: string;
  runGrant: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ResolvedModel {
  model: LanguageModel;
  driver: ModelBinding['driver'];
  modelId: string;
  providerOptions?: ToolLoopAgentSettings['providerOptions'];
}

export interface ModelResolver {
  resolve(binding: ModelBinding, options: ResolveModelOptions): Promise<ResolvedModel>;
}

export class DefaultModelResolver implements ModelResolver {
  constructor(private readonly credentials: CredentialResolver) {}

  async resolve(binding: ModelBinding, options: ResolveModelOptions): Promise<ResolvedModel> {
    const credential = await this.credentials.resolve(
      {
        runId: options.runId,
        runGrant: options.runGrant,
        purpose: 'model',
        audience: `model:${binding.driver}`,
        bindingId: binding.credentialBindingId,
        minimumTtlMs: options.timeoutMs + 5000,
      },
      options.signal,
    );

    try {
      if (binding.driver === 'anthropic') {
        const { createAnthropic } = await import('@ai-sdk/anthropic');
        const provider = createAnthropic(
          credential.type === 'bearer'
            ? { authToken: credential.value }
            : { apiKey: credential.value },
        );
        return { model: provider(binding.modelId), driver: binding.driver, modelId: binding.modelId };
      }

      const { createOpenAI } = await import('@ai-sdk/openai');
      const provider = createOpenAI({
        apiKey: credential.value,
        ...(binding.baseUrl ? { baseURL: binding.baseUrl } : {}),
        ...(binding.driver === 'openai-compatible' ? { name: binding.bindingId } : {}),
      });
      const model =
        binding.driver === 'openai-compatible'
          ? provider.chat(binding.modelId)
          : provider(binding.modelId);
      return {
        model,
        driver: binding.driver,
        modelId: binding.modelId,
        // OpenAI strict structured outputs reject object schemas with optional fields.
        // The harness validates the original schema locally and OM validates it again.
        ...(binding.driver === 'openai'
          ? { providerOptions: { openai: { strictJsonSchema: false } } }
          : {}),
      };
    } catch (error) {
      throw new HarnessError('MODEL_FAILED', `Could not initialize model binding ${binding.bindingId}`, {
        cause: error,
      });
    }
  }
}
