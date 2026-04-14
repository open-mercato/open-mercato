/**
 * Curated registry of OpenAI-compatible LLM backends.
 *
 * Each preset is plain data — adding a new backend takes one entry in
 * this array, zero new adapter files, and zero changes to route handlers.
 * The {@link createOpenAICompatibleProvider} factory in `./llm-adapters/openai.ts`
 * turns each preset into a concrete `LlmProvider` at bootstrap time.
 *
 * Preset model catalogs are curated snapshots as of 2026-04-14 and should
 * be updated as upstream catalogs evolve. Users can always override the
 * selected model via the `OPENCODE_MODEL` env var without editing this
 * file.
 *
 * @see ./llm-adapters/openai.ts
 * @see .ai/specs/2026-04-14-llm-provider-ports-and-adapters.md
 */

import type { OpenAICompatiblePreset } from './llm-adapters/openai'

/**
 * Standard OpenAI — default OpenAI API at api.openai.com.
 */
const OPENAI_PRESET: OpenAICompatiblePreset = {
  id: 'openai',
  name: 'OpenAI',
  baseURL: undefined,
  envKeys: ['OPENAI_API_KEY'],
  defaultModel: 'gpt-5-mini',
  defaultModels: [
    {
      id: 'gpt-5-mini',
      name: 'GPT-5 Mini',
      contextWindow: 128000,
      tags: ['budget'],
    },
    {
      id: 'gpt-5',
      name: 'GPT-5',
      contextWindow: 128000,
      tags: ['flagship'],
    },
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      contextWindow: 128000,
      tags: ['budget'],
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      contextWindow: 128000,
    },
  ],
}

/**
 * DeepInfra — hosts open-weight flagship models at 3-12× lower cost than
 * the native APIs. The curated catalog targets the AI Assistant use case
 * (routing + tool use + conversational chat).
 */
const DEEPINFRA_PRESET: OpenAICompatiblePreset = {
  id: 'deepinfra',
  name: 'DeepInfra',
  baseURL: 'https://api.deepinfra.com/v1/openai',
  envKeys: ['DEEPINFRA_API_KEY'],
  defaultModel: 'zai-org/GLM-5.1',
  defaultModels: [
    {
      id: 'zai-org/GLM-5.1',
      name: 'GLM-5.1 (Zhipu)',
      contextWindow: 202752,
      tags: ['flagship'],
    },
    {
      id: 'zai-org/GLM-4.7-Flash',
      name: 'GLM-4.7 Flash',
      contextWindow: 202752,
      tags: ['budget'],
    },
    {
      id: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
      name: 'Qwen3 235B (MoE)',
      contextWindow: 262144,
      tags: ['flagship'],
    },
    {
      id: 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
      name: 'Llama 4 Scout',
      contextWindow: 327680,
    },
    {
      id: 'deepseek-ai/DeepSeek-V3.2-Exp',
      name: 'DeepSeek V3.2',
      contextWindow: 163840,
      tags: ['reasoning'],
    },
    {
      id: 'Qwen/Qwen3-Coder-30B-A3B-Instruct',
      name: 'Qwen3 Coder 30B',
      contextWindow: 262144,
      tags: ['coding'],
    },
  ],
}

/**
 * Groq — specializes in low-latency inference on LPU hardware.
 * Best suited for snappy tool-use and routing, less so for long reasoning.
 */
const GROQ_PRESET: OpenAICompatiblePreset = {
  id: 'groq',
  name: 'Groq',
  baseURL: 'https://api.groq.com/openai/v1',
  envKeys: ['GROQ_API_KEY'],
  defaultModel: 'llama-3.3-70b-versatile',
  defaultModels: [
    {
      id: 'llama-3.3-70b-versatile',
      name: 'Llama 3.3 70B Versatile',
      contextWindow: 131072,
    },
    {
      id: 'llama-4-scout-17b',
      name: 'Llama 4 Scout 17B',
      contextWindow: 131072,
    },
    {
      id: 'mixtral-8x22b-32768',
      name: 'Mixtral 8x22B',
      contextWindow: 32768,
    },
  ],
}

/**
 * Together AI — broad catalog of open-weight models with per-model pricing.
 */
const TOGETHER_PRESET: OpenAICompatiblePreset = {
  id: 'together',
  name: 'Together AI',
  baseURL: 'https://api.together.xyz/v1',
  envKeys: ['TOGETHER_API_KEY'],
  defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  defaultModels: [
    {
      id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      name: 'Llama 3.3 70B Turbo',
      contextWindow: 131072,
    },
    {
      id: 'Qwen/Qwen2.5-72B-Instruct-Turbo',
      name: 'Qwen 2.5 72B Turbo',
      contextWindow: 32768,
    },
  ],
}

/**
 * Fireworks AI — fast inference with a curated catalog.
 */
const FIREWORKS_PRESET: OpenAICompatiblePreset = {
  id: 'fireworks',
  name: 'Fireworks AI',
  baseURL: 'https://api.fireworks.ai/inference/v1',
  envKeys: ['FIREWORKS_API_KEY'],
  defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
  defaultModels: [
    {
      id: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
      name: 'Llama 3.3 70B',
      contextWindow: 131072,
    },
  ],
}

/**
 * Azure OpenAI — enterprise Azure deployments. Base URL is deployment-
 * specific and must be provided via `AZURE_OPENAI_BASE_URL`.
 */
const AZURE_PRESET: OpenAICompatiblePreset = {
  id: 'azure',
  name: 'Azure OpenAI',
  baseURL: undefined,
  baseURLEnvKeys: ['AZURE_OPENAI_BASE_URL'],
  envKeys: ['AZURE_OPENAI_API_KEY'],
  defaultModel: 'gpt-5-mini',
  defaultModels: [
    {
      id: 'gpt-5-mini',
      name: 'GPT-5 Mini',
      contextWindow: 128000,
    },
    {
      id: 'gpt-5',
      name: 'GPT-5',
      contextWindow: 128000,
    },
  ],
}

/**
 * LiteLLM proxy — self-hosted router for arbitrary upstream providers.
 * Base URL must be supplied via `LITELLM_BASE_URL`.
 */
const LITELLM_PRESET: OpenAICompatiblePreset = {
  id: 'litellm',
  name: 'LiteLLM',
  baseURL: 'http://localhost:4000/v1',
  baseURLEnvKeys: ['LITELLM_BASE_URL'],
  envKeys: ['LITELLM_API_KEY'],
  defaultModel: 'gpt-4o-mini',
  defaultModels: [
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini (via LiteLLM)',
      contextWindow: 128000,
    },
  ],
}

/**
 * Ollama — local model runner for development and offline use.
 * Default port 11434 can be overridden via `OLLAMA_BASE_URL`.
 */
const OLLAMA_PRESET: OpenAICompatiblePreset = {
  id: 'ollama',
  name: 'Ollama (local)',
  baseURL: 'http://localhost:11434/v1',
  baseURLEnvKeys: ['OLLAMA_BASE_URL'],
  envKeys: ['OLLAMA_API_KEY'],
  defaultModel: 'llama3.3',
  defaultModels: [
    {
      id: 'llama3.3',
      name: 'Llama 3.3 (local)',
      contextWindow: 131072,
    },
    {
      id: 'qwen2.5-coder',
      name: 'Qwen 2.5 Coder (local)',
      contextWindow: 131072,
      tags: ['coding'],
    },
  ],
}

/**
 * Built-in presets registered at bootstrap time. Order matters — it
 * determines the default iteration order of
 * `llmProviderRegistry.resolveFirstConfigured()` when no explicit order
 * is supplied.
 */
export const OPENAI_COMPATIBLE_PRESETS: readonly OpenAICompatiblePreset[] = [
  OPENAI_PRESET,
  DEEPINFRA_PRESET,
  GROQ_PRESET,
  TOGETHER_PRESET,
  FIREWORKS_PRESET,
  AZURE_PRESET,
  LITELLM_PRESET,
  OLLAMA_PRESET,
]
