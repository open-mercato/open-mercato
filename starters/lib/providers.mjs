import readline from 'node:readline'

import { addEnvValue, readEnvValue } from './env-file.mjs'
import { secretFingerprint } from './secrets.mjs'

// Every OM-supported chat provider (from apps/mercato/.env.example). Kept in
// sync by hand with $script:LlmProviders in
// starters/docker/windows/start-dev.ps1 (which must stay Node-less).
// Embedding-only providers (Mistral, Cohere, AWS Bedrock) are excluded — the
// assistant needs a chat model.
export const LLM_PROVIDERS = [
  { provider: 'openai', label: 'OpenAI', keyEnv: 'OPENAI_API_KEY', baseUrlEnv: 'OPENAI_BASE_URL', keyRequired: true, baseUrlRequired: false, baseUrl: '', modelRequired: false, modelHint: 'e.g. gpt-5-mini' },
  { provider: 'anthropic', label: 'Anthropic (Claude)', keyEnv: 'ANTHROPIC_API_KEY', baseUrlEnv: null, keyRequired: true, baseUrlRequired: false, baseUrl: '', modelRequired: false, modelHint: 'e.g. claude-haiku-4-5-20251001' },
  { provider: 'google', label: 'Google Gemini', keyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY', baseUrlEnv: null, keyRequired: true, baseUrlRequired: false, baseUrl: '', modelRequired: false, modelHint: 'e.g. gemini-3-flash' },
  { provider: 'azure', label: 'Azure OpenAI / AI Foundry', keyEnv: 'AZURE_OPENAI_API_KEY', baseUrlEnv: 'AZURE_OPENAI_BASE_URL', keyRequired: true, baseUrlRequired: true, baseUrl: '', modelRequired: true, modelHint: 'your Azure deployment name' },
  { provider: 'openrouter', label: 'OpenRouter (gateway)', keyEnv: 'OPENROUTER_API_KEY', baseUrlEnv: 'OPENROUTER_BASE_URL', keyRequired: true, baseUrlRequired: false, baseUrl: '', modelRequired: false, modelHint: 'e.g. meta-llama/llama-3.3-70b-instruct' },
  { provider: 'deepinfra', label: 'DeepInfra', keyEnv: 'DEEPINFRA_API_KEY', baseUrlEnv: 'DEEPINFRA_BASE_URL', keyRequired: true, baseUrlRequired: false, baseUrl: '', modelRequired: false, modelHint: 'e.g. zai-org/GLM-5.1' },
  { provider: 'groq', label: 'Groq', keyEnv: 'GROQ_API_KEY', baseUrlEnv: 'GROQ_BASE_URL', keyRequired: true, baseUrlRequired: false, baseUrl: '', modelRequired: false, modelHint: 'e.g. llama-3.3-70b-versatile' },
  { provider: 'together', label: 'Together AI', keyEnv: 'TOGETHER_API_KEY', baseUrlEnv: 'TOGETHER_BASE_URL', keyRequired: true, baseUrlRequired: false, baseUrl: '', modelRequired: false, modelHint: 'e.g. meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  { provider: 'fireworks', label: 'Fireworks AI', keyEnv: 'FIREWORKS_API_KEY', baseUrlEnv: 'FIREWORKS_BASE_URL', keyRequired: true, baseUrlRequired: false, baseUrl: '', modelRequired: false, modelHint: 'e.g. accounts/fireworks/models/llama-v3p3-70b-instruct' },
  { provider: 'litellm', label: 'LiteLLM (self-hosted proxy)', keyEnv: 'LITELLM_API_KEY', baseUrlEnv: 'LITELLM_BASE_URL', keyRequired: true, baseUrlRequired: true, baseUrl: '', modelRequired: true, modelHint: 'model name as configured in your proxy' },
  { provider: 'ollama', label: 'Ollama (local)', keyEnv: 'OLLAMA_API_KEY', baseUrlEnv: 'OLLAMA_BASE_URL', keyRequired: false, baseUrlRequired: true, baseUrl: 'http://host.docker.internal:11434/v1', modelRequired: true, modelHint: 'e.g. llama3.3' },
  { provider: 'lm-studio', label: 'LM Studio (local)', keyEnv: 'LM_STUDIO_API_KEY', baseUrlEnv: 'LM_STUDIO_BASE_URL', keyRequired: false, baseUrlRequired: true, baseUrl: 'http://host.docker.internal:1234/v1', modelRequired: true, modelHint: 'the loaded model id' },
]

function applyProviderConfig(rootEnv, entry, { key = '', baseUrl = '', model = '' }, log) {
  if (key.trim()) {
    if (addEnvValue(rootEnv, entry.keyEnv, key.trim(), { replaceEmpty: true })) {
      log(`  set ${entry.keyEnv} (${secretFingerprint(key.trim())})`)
    }
  }
  if (entry.baseUrlEnv && baseUrl.trim()) {
    if (addEnvValue(rootEnv, entry.baseUrlEnv, baseUrl.trim(), { replaceEmpty: true })) {
      log(`  set ${entry.baseUrlEnv}=${baseUrl.trim()}`)
    }
  }
  if (addEnvValue(rootEnv, 'OM_AI_PROVIDER', entry.provider, { replaceEmpty: true })) {
    log(`  set OM_AI_PROVIDER=${entry.provider}`)
  }
  if (model.trim()) {
    if (addEnvValue(rootEnv, 'OM_AI_MODEL', model.trim(), { replaceEmpty: true })) {
      log(`  set OM_AI_MODEL=${model.trim()}`)
    }
  }
}

// Returns 'configured' | 'skipped' | 'failed'. Mirrors the semantics of the
// Windows launcher's Invoke-LlmProviderPrompt: OM_AI_PROVIDER or an existing
// key in .env means "already configured"; a key in the ambient environment is
// persisted without prompting; otherwise prompt interactively unless
// skip/non-interactive flags are set.
export async function ensureLlmProvider(rootEnv, { skipPrompt = false, nonInteractive = false, log = console.log, warn = console.warn } = {}) {
  const configuredProvider = readEnvValue(rootEnv, 'OM_AI_PROVIDER')
  if (configuredProvider && configuredProvider.trim()) {
    log(`AI already configured: provider '${configuredProvider.trim()}' (from .env)`)
    return 'configured'
  }

  for (const entry of LLM_PROVIDERS) {
    const fromFile = readEnvValue(rootEnv, entry.keyEnv)
    if (fromFile && fromFile.trim()) {
      log(`AI already configured: ${entry.label}`)
      return 'configured'
    }
    const fromEnv = process.env[entry.keyEnv]
    if (fromEnv && fromEnv.trim()) {
      const baseFromEnv = entry.baseUrlEnv ? process.env[entry.baseUrlEnv] ?? '' : ''
      applyProviderConfig(rootEnv, entry, { key: fromEnv, baseUrl: baseFromEnv }, log)
      log(`AI configured from environment: ${entry.label}`)
      return 'configured'
    }
  }

  if (skipPrompt) {
    warn('LLM prompt skipped with no provider key — AI chat will not work until you set a provider (e.g. OPENAI_API_KEY) in .env and restart the opencode container.')
    return 'skipped'
  }
  if (nonInteractive || !process.stdin.isTTY) {
    warn('No LLM provider API key found. Set a provider key (e.g. OPENAI_API_KEY) in the environment or .env, or pass --skip-llm-prompt to proceed without AI.')
    return 'failed'
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = (question) => new Promise((resolve) => rl.question(question, resolve))

  try {
    console.log('')
    console.log('The AI assistant (OpenCode + MCP) needs one LLM provider to power the Cmd+K agent.')
    console.log('Setup requires one to continue. (Ctrl+C aborts; re-run later with --skip-llm-prompt to configure it in .env yourself.)')

    while (true) {
      console.log('')
      LLM_PROVIDERS.forEach((entry, index) => {
        console.log(`  [${String(index + 1).padStart(2)}] ${entry.label}`)
      })
      const choice = await ask(`Choose a provider [1-${LLM_PROVIDERS.length}]: `)
      const index = Number.parseInt(choice, 10)
      if (!Number.isInteger(index) || index < 1 || index > LLM_PROVIDERS.length) {
        console.log(`Please enter a number between 1 and ${LLM_PROVIDERS.length}.`)
        continue
      }
      const selected = LLM_PROVIDERS[index - 1]

      let key = ''
      if (selected.keyRequired) {
        key = (await ask(`Paste your ${selected.label} API key: `)).trim()
        if (!key) {
          console.log('A key is required for this provider. Try again.')
          continue
        }
      } else {
        key = (await ask(`${selected.label} API key (optional for local servers — press Enter to skip): `)).trim()
      }

      let baseUrl = ''
      if (selected.baseUrlEnv) {
        const promptText = selected.baseUrlRequired
          ? (selected.baseUrl ? `${selected.label} base URL [${selected.baseUrl}]: ` : `${selected.label} base URL (required): `)
          : `${selected.label} base URL (optional — press Enter for the provider default): `
        const entered = (await ask(promptText)).trim()
        baseUrl = entered || selected.baseUrl
        if (selected.baseUrlRequired && !baseUrl) {
          console.log('This provider requires a base URL. Try again.')
          continue
        }
      }

      const modelPrompt = selected.modelRequired
        ? `${selected.label} model (${selected.modelHint}) (required): `
        : `${selected.label} model (${selected.modelHint}) (optional — press Enter for the default): `
      const model = (await ask(modelPrompt)).trim()
      if (selected.modelRequired && !model) {
        console.log('This provider needs a model/deployment id. Try again.')
        continue
      }

      applyProviderConfig(rootEnv, selected, { key, baseUrl, model }, log)
      log(`AI provider configured: ${selected.label}`)
      return 'configured'
    }
  } finally {
    rl.close()
  }
}
