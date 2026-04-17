// Re-export AI SDK functions from the ai-assistant package
export { streamText, generateObject, stepCountIs } from 'ai'
export { createOpenAI } from '@ai-sdk/openai'
export { createAnthropic } from '@ai-sdk/anthropic'
export { createGoogleGenerativeAI } from '@ai-sdk/google'

// Side-effect import: registers built-in LLM providers (Anthropic, Google,
// OpenAI + OpenAI-compatible presets for DeepInfra, Groq, Together, etc.)
// with the shared `llmProviderRegistry` singleton. Consumers that import
// from `./ai-sdk` transitively trigger provider bootstrap, so any module
// using `generateObject` / `streamText` already has the registry populated.
//
// @see ./llm-bootstrap.ts
// @see .ai/specs/2026-04-14-llm-provider-ports-and-adapters.md
import './llm-bootstrap'
