/**
 * LLM Provider port interface — describes the contract every LLM adapter
 * (Anthropic, Google, OpenAI, or any OpenAI-compatible preset) must fulfill.
 *
 * Adapters represent PROTOCOLS (Anthropic Messages, Google GenAI, OpenAI
 * chat-completions), not VENDORS. A single OpenAI-compatible adapter can
 * serve OpenAI, DeepInfra, Groq, Together, Fireworks, Azure, LiteLLM, Ollama,
 * or any other backend that implements the OpenAI wire format.
 *
 * Vendor-specific configuration (endpoint URL, available models, display
 * name, env var conventions) lives in `openai-compatible-presets.ts` as
 * plain data, not code.
 *
 * @see packages/shared/src/lib/ai/llm-provider-registry.ts
 * @see .ai/specs/2026-04-14-llm-provider-ports-and-adapters.md
 */

export type EnvLookup = Record<string, string | undefined>

/**
 * Metadata describing a single model available in an LLM provider.
 *
 * Used by the AI Assistant UI to populate model dropdowns and by the
 * routing layer to pick defaults when `OM_AI_MODEL` is not set.
 */
export interface LlmModelInfo {
  /**
   * Canonical model identifier as accepted by the upstream API
   * (e.g. `claude-haiku-4-5-20251001`, `gpt-4o-mini`, `zai-org/GLM-5.1`).
   */
  id: string
  /**
   * Human-readable display name for UI dropdowns
   * (e.g. `Claude Haiku 4.5`, `GLM-5.1 (Zhipu)`).
   */
  name: string
  /**
   * Maximum context window in tokens. Used by the UI to show capabilities
   * and by the routing layer to reject oversized prompts.
   */
  contextWindow: number
  /**
   * Optional UI tags for filtering and badging
   * (`flagship`, `budget`, `reasoning`, `coding`, `vision`).
   */
  tags?: readonly string[]
}

/**
 * Arguments passed to {@link LlmProvider.createModel} when the routing layer
 * needs a concrete AI SDK model instance for a specific chat request.
 */
export interface LlmCreateModelOptions {
  /** Upstream model id (e.g. `claude-haiku-4-5-20251001`). */
  modelId: string
  /** Resolved API key for the provider. */
  apiKey: string
  /**
   * Optional override for the upstream base URL. Every OpenAI-compatible
   * adapter MUST honor baseURL; Anthropic now also honors it (Messages-
   * protocol relays only — Cloudflare AI Gateway in Anthropic mode, Helicone
   * proxy); Google honors it when the SDK supports it (@ai-sdk/google ≥3.0).
   */
  baseURL?: string
  /**
   * Optional opaque, non-reversible end-user identifier attached to the model
   * call so provider-side abuse enforcement can target a single end user
   * instead of the whole API-key organization. The runtime computes this as a
   * tenant-salted HMAC (no PII leaves the platform); the adapter decides how to
   * map it into per-call `providerOptions` via
   * {@link LlmProvider.mapEndUserIdentifier}. Adapters without a mapping ignore
   * it. Always optional — absent identifiers reproduce today's behavior.
   */
  endUserIdentifier?: string
}

/**
 * Core port interface implemented by every LLM adapter.
 *
 * An adapter is a stateless object — the registry instantiates one instance
 * per provider at bootstrap time and reuses it for the process lifetime.
 * Adapters MUST NOT hold mutable state between calls.
 *
 * Implementations live in `packages/ai-assistant/src/modules/ai_assistant/lib/llm-adapters/`.
 */
export interface LlmProvider {
  /**
   * Stable identifier used in configuration, env vars, and the registry.
   * MUST be lowercase snake_case or kebab-case (e.g. `anthropic`, `deepinfra`,
   * `openai`, `internal-litellm`). The `OM_AI_PROVIDER` env var resolves to
   * this value; the legacy `OPENCODE_PROVIDER` env var is a BC fallback.
   */
  readonly id: string
  /** Human-readable display name for UI dropdowns. */
  readonly name: string
  /**
   * Environment variable names where this provider looks for its API key,
   * in priority order. The first non-empty value wins.
   */
  readonly envKeys: readonly string[]
  /**
   * Default model id returned by {@link LlmProvider.defaultModels}[0]
   * when the caller does not specify one. Used by the routing layer when
   * `OM_AI_MODEL` is not set.
   */
  readonly defaultModel: string
  /** Curated list of models shown in the UI dropdown for this provider. */
  readonly defaultModels: readonly LlmModelInfo[]

  /**
   * Returns true when the provider has all required configuration present
   * (typically, a non-empty API key in one of the {@link envKeys}).
   *
   * @param env - Optional environment lookup. Defaults to `process.env`.
   */
  isConfigured(env?: EnvLookup): boolean

  /**
   * Reads the API key from the environment, checking {@link envKeys} in
   * priority order. Returns the first non-empty trimmed value, or `null`
   * when no key is set.
   */
  resolveApiKey(env?: EnvLookup): string | null

  /**
   * Returns the env var name that supplied the currently configured key
   * (or the first declared key when none are set — used for error messages
   * like `Set ANTHROPIC_API_KEY to enable`).
   */
  getConfiguredEnvKey(env?: EnvLookup): string

  /**
   * Creates a concrete AI SDK model instance ready to pass to
   * `generateObject`, `streamText`, or other AI SDK v5 functions.
   *
   * Returns `unknown` because AI SDK model types are complex generics that
   * differ per provider (`anthropic.LanguageModelV1`, `openai.ChatModel`,
   * etc.) and threading them through the port interface would either (a)
   * infect every caller with generic parameters, or (b) force `shared` to
   * depend on every SDK simultaneously. Call sites cast to the concrete
   * type expected by `generateObject` / `streamText`, mirroring the
   * behavior at `packages/ai-assistant/src/modules/ai_assistant/api/route/route.ts`.
   */
  createModel(options: LlmCreateModelOptions): unknown

  /**
   * Optional. Maps a runtime-computed end-user identifier (see
   * {@link LlmCreateModelOptions.endUserIdentifier}) into the AI SDK
   * `providerOptions` fragment this provider understands — e.g. OpenAI returns
   * `{ openai: { safety_identifier } }`, Anthropic returns
   * `{ anthropic: { user: { id } } }`. The runtime merges the returned fragment
   * into the per-call `providerOptions`. Adapters that omit this method send no
   * identifier (today's behavior). Implementations MUST be pure and stateless.
   */
  mapEndUserIdentifier?(identifier: string): Record<string, unknown>

  /**
   * Optional. When `true`, the runtime may run input pre-moderation through
   * this provider's moderation endpoint before the model call. Only providers
   * that actually expose a moderation API (initially the OpenAI adapter) set
   * this. Absent/`false` means the moderation gate is skipped for this provider
   * and the surface relies on the provider's own server-side filtering.
   */
  readonly supportsInputModeration?: boolean
}
