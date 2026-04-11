# SPEC: Decentralized AI Assistant

**Date:** 2026-04-11
**Status:** Draft
**Scope:** OSS
**Consensus:** Claude Opus + Gemini 2.5 Pro (neutral 9/10, adversarial 9/10), verified with Gemini 3 Pro (neutral 9/10, adversarial 9/10)

## Summary

Replace the centralized AI assistant architecture (Code Mode + OpenCode) with a decentralized, module-driven system where each module declares its AI capabilities via an `ai-manifest.ts` file. The conversation loop moves inside the application via Vercel AI SDK, and a retrieval-based router selects relevant modules per query.

## Motivation

The current architecture has three structural problems:

1. **Code Mode centralizes all knowledge.** Two meta-tools (`search` + `execute`) flatten the entire OpenAPI spec into a single tool surface. Modules can't contribute domain expertise, and the AI has no guidance on which operations are appropriate.

2. **OpenCode is an opaque intermediary.** The chat route delegates all LLM orchestration to an external OpenCode server. The application can't intercept, customize, or extend the reasoning. It adds operational complexity (separate process, separate auth).

3. **Module AI tools are dead code.** Modules already export typed `ai-tools.ts` files (inbox_ops, search), discovered by a CLI generator into `ai-tools.generated.ts`. But these are never loaded at runtime.

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Chat Route                        │
│  POST /api/chat                                      │
├─────────────────────────────────────────────────────┤
│  1. Authenticate (session token / API key)           │
│  2. Resolve provider + model from .env               │
│  3. Route: select modules via manifest metadata      │
│  4. Compose: build system prompt from module          │
│     fragments using structured template               │
│  5. Execute: streamText() with module tools          │
│     via InProcessMcpClient + mcp-tool-adapter        │
└─────────────────┬───────────────────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    ▼             ▼             ▼
┌────────┐  ┌────────┐  ┌────────┐
│ sales  │  │ search │  │ inbox  │  ... per-module
│manifest│  │manifest│  │manifest│      ai-manifest.ts
└───┬────┘  └───┬────┘  └───┬────┘
    │           │           │
    ▼           ▼           ▼
┌─────────────────────────────────────────────────────┐
│              Tool Registry (existing)                │
│  registerMcpTool() → getToolRegistry()              │
├─────────────────────────────────────────────────────┤
│              InProcessMcpClient (existing)            │
│  listToolsWithSchemas() → callTool()                │
├─────────────────────────────────────────────────────┤
│              mcp-tool-adapter (existing)              │
│  convertMcpToolsToAiSdk() → dynamicTool()           │
└─────────────────────────────────────────────────────┘

External AI tools (Claude Desktop, Cursor, etc.)
  → MCP Server (stdio/HTTP) → same tool registry
```

---

## Phase 1: Foundation — Types, Generator, Provider Rename

### 1.1 AiManifest Type Definition

Create `packages/shared/src/modules/ai.ts`:

```typescript
import type { z } from 'zod'
import type { AwilixContainer } from 'awilix'

// ─── Tool Context ────────────────────────────────────────────

export type AiToolContext = {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: AwilixContainer
  userFeatures: string[]
  isSuperAdmin: boolean
  apiKeySecret?: string
  sessionId?: string
}

// ─── Tool Definition ─────────────────────────────────────────

export type AiToolDefinition<TInput = unknown, TOutput = unknown> = {
  /** Unique tool name (snake_case, prefixed with module: e.g., sales_create_quote) */
  name: string
  /** Human-readable description for the LLM */
  description: string
  /** Zod schema for input validation */
  inputSchema: z.ZodType<TInput>
  /** Required ACL features to execute */
  requiredFeatures?: string[]
  /** Handler function */
  handler: (input: TInput, context: AiToolContext) => Promise<TOutput>
}

// ─── Data Capability ─────────────────────────────────────────

export type AiDataCapability = {
  /** Entity name (e.g., 'company', 'order', 'product') */
  entity: string
  /** Human-readable description for AI context */
  description: string
  /** Supported operations */
  operations: Array<'list' | 'get' | 'create' | 'update' | 'delete' | 'search' | 'aggregate'>
  /** Fields available for searching/filtering */
  searchableFields?: string[]
  /** Relationships to other module entities */
  relationships?: Array<{
    entity: string
    module: string
    type: 'belongsTo' | 'hasMany' | 'manyToMany'
  }>
}

// ─── Context Dependency ──────────────────────────────────────

export type AiContextDependency = {
  /** Module ID to pull in (e.g., 'customers', 'catalog') */
  moduleId: string
  /** Why this dependency exists — helps the router and debugging */
  reason: string
  /** Is this a hard requirement or optional enrichment? */
  required: boolean
}

// ─── AI Manifest ─────────────────────────────────────────────

export type AiManifest = {
  /** Domain label for routing (e.g., 'CRM', 'Sales', 'Inventory') */
  domain: string
  /** Brief description of module's AI capabilities */
  description: string
  /** Keywords for retrieval-based routing */
  keywords?: string[]
  /** Data this module can expose to the AI */
  dataCapabilities: AiDataCapability[]
  /** Tool definitions */
  tools: AiToolDefinition[]
  /** System prompt fragment injected when this module is active */
  systemContext?: string
  /** Other modules whose tools/context should be co-activated */
  contextDependencies?: AiContextDependency[]
  /** Required ACL features to access any AI capability in this module */
  requiredFeatures?: string[]
  /** Preferred model tier for this module's operations */
  preferredModelTier?: 'fast' | 'standard' | 'powerful'
}

// ─── Generated Entry ─────────────────────────────────────────

export type AiManifestEntry = {
  moduleId: string
  manifest: AiManifest
}
```

### 1.2 Extend Module Type

In `packages/shared/src/modules/registry.ts`, add one optional field:

```typescript
export type Module = {
  // ... all existing fields unchanged ...
  /** AI assistant capabilities declared by this module */
  aiManifest?: import('./ai').AiManifest
}
```

This is additive and non-breaking. No existing code changes behavior.

### 1.3 Generator: ai-manifest.ts Discovery

Create `packages/cli/src/lib/generators/extensions/ai-manifests.ts`.

The generator scans all module directories for `ai-manifest.ts` files, same pattern as the existing `ai-tools.ts` generator. Produces:

```typescript
// apps/mercato/.mercato/generated/ai-manifests.generated.ts
import * as MANIFEST_customers from "@open-mercato/core/modules/customers/ai-manifest"
import * as MANIFEST_sales from "@open-mercato/core/modules/sales/ai-manifest"
// ...

export const aiManifestEntries: AiManifestEntry[] = [
  { moduleId: "customers", manifest: MANIFEST_customers.aiManifest },
  { moduleId: "sales", manifest: MANIFEST_sales.aiManifest },
  // ...
]
```

### 1.4 Backward Compatibility: Auto-Wrap ai-tools.ts

Modules with `ai-tools.ts` but no `ai-manifest.ts` get an auto-generated minimal manifest:

```typescript
// Generated wrapper for modules with ai-tools.ts but no ai-manifest.ts
{
  moduleId: "inbox_ops",
  manifest: {
    domain: metadata.title ?? moduleId,      // from module index.ts
    description: metadata.description ?? '',
    keywords: [moduleId],
    dataCapabilities: [],                    // empty — no data declarations
    tools: aiTools,                          // from existing ai-tools.ts
  }
}
```

This ensures existing `inbox_ops` and `search` tools work immediately without migration.

### 1.5 Provider Rename

Rename the shared abstraction from "OpenCode" to "Ai" vocabulary. Both old and new names work during transition.

**New file:** `packages/shared/src/lib/ai/ai-provider.ts`

```typescript
export type AiProviderId = 'anthropic' | 'openai' | 'google'

export type AiProviderDefinition = {
  id: AiProviderId
  name: string
  envKeys: readonly string[]
  models: {
    fast: string       // classification, routing, simple tasks
    standard: string   // chat, tool use, general tasks
    powerful: string   // complex reasoning, multi-step planning
  }
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderDefinition> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    envKeys: ['ANTHROPIC_API_KEY'],
    models: { fast: 'claude-haiku-4-5-20251001', standard: 'claude-sonnet-4-20250514', powerful: 'claude-opus-4-20250514' },
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    envKeys: ['OPENAI_API_KEY'],
    models: { fast: 'gpt-4o-mini', standard: 'gpt-4o', powerful: 'o3' },
  },
  google: {
    id: 'google',
    name: 'Google',
    envKeys: ['GOOGLE_GENERATIVE_AI_API_KEY'],
    models: { fast: 'gemini-2.0-flash-lite', standard: 'gemini-2.5-flash', powerful: 'gemini-2.5-pro' },
  },
}

/**
 * Resolve provider ID.
 * Priority: AI_PROVIDER env → OPENCODE_PROVIDER env (legacy) → first configured → 'anthropic'
 */
export function resolveAiProviderId(env = process.env): AiProviderId { ... }

/** Resolve API key for a provider. */
export function resolveAiProviderApiKey(providerId: AiProviderId, env = process.env): string | null { ... }

/**
 * Resolve model ID with full priority chain.
 * Priority: per-module env (SALES_AI_MODEL) → AI_MODEL → OPENCODE_MODEL (legacy) → tier default
 */
export function resolveAiModel(providerId: AiProviderId, options?: {
  moduleId?: string
  preferredTier?: 'fast' | 'standard' | 'powerful'
  overrideModel?: string
}): { modelId: string; modelWithProvider: string; source: string } { ... }
```

**Old file:** `packages/shared/src/lib/ai/opencode-provider.ts` — add `@deprecated` JSDoc to all exports, make them thin wrappers calling the new functions.

### 1.6 Model Factory (Lifted from inbox_ops)

**New file:** `packages/shared/src/lib/ai/model-factory.ts`

```typescript
import type { LanguageModelV1 } from 'ai'
import type { AiProviderId } from './ai-provider'

/**
 * Create a Vercel AI SDK model instance. Dynamically imports the correct @ai-sdk/* package.
 * This is the ONLY place provider-specific imports live.
 */
export async function createAiModel(
  providerId: AiProviderId,
  apiKey: string,
  modelId: string,
): Promise<LanguageModelV1> {
  switch (providerId) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return createAnthropic({ apiKey })(modelId) as LanguageModelV1
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI({ apiKey })(modelId) as LanguageModelV1
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      return createGoogleGenerativeAI({ apiKey })(modelId) as LanguageModelV1
    }
  }
}

/**
 * Resolve provider + model + key from env, return a ready model.
 * This is what most module code should call.
 */
export async function resolveAndCreateAiModel(options?: {
  moduleId?: string
  preferredTier?: 'fast' | 'standard' | 'powerful'
  overrideModel?: string
}): Promise<{ model: LanguageModelV1; modelWithProvider: string; providerId: AiProviderId }> {
  const providerId = resolveAiProviderId()
  const apiKey = resolveAiProviderApiKey(providerId)
  if (!apiKey) throw new Error(`No API key configured for provider "${providerId}"`)
  const resolution = resolveAiModel(providerId, options)
  const model = await createAiModel(providerId, apiKey, resolution.modelId)
  return { model, modelWithProvider: resolution.modelWithProvider, providerId }
}
```

Update `inbox_ops/lib/llmProvider.ts` to import from `@open-mercato/shared/lib/ai/model-factory` instead of implementing its own factory.

### Files Created/Modified in Phase 1

| Action | File |
|--------|------|
| CREATE | `packages/shared/src/modules/ai.ts` |
| MODIFY | `packages/shared/src/modules/registry.ts` (add `aiManifest?` field) |
| CREATE | `packages/cli/src/lib/generators/extensions/ai-manifests.ts` |
| CREATE | `packages/shared/src/lib/ai/ai-provider.ts` |
| CREATE | `packages/shared/src/lib/ai/model-factory.ts` |
| MODIFY | `packages/shared/src/lib/ai/opencode-provider.ts` (deprecate, wrap) |
| MODIFY | `packages/core/src/modules/inbox_ops/lib/llmProvider.ts` (use shared factory) |

---

## Phase 2: Vercel AI SDK Chat Route

### 2.1 Re-Enable Module Tool Loading

In `packages/ai-assistant/src/modules/ai_assistant/lib/tool-loader.ts`, add loading from the generated file:

```typescript
export async function loadAllModuleTools(): Promise<void> {
  // 1. Built-in tools
  registerMcpTool(contextWhoamiTool, { moduleId: 'context' })

  // 2. Module AI tools (from ai-tools.generated.ts and ai-manifests.generated.ts)
  try {
    const { aiToolConfigEntries } = await import('@/.mercato/generated/ai-tools.generated')
    for (const entry of aiToolConfigEntries) {
      loadModuleTools(entry.moduleId, entry.tools as ModuleAiTool[])
    }
    console.error(`[MCP Tools] Loaded tools from ${aiToolConfigEntries.length} modules`)
  } catch (error) {
    console.error('[MCP Tools] Could not load module AI tools:', error)
  }

  // 3. Code Mode tools (kept as fallback for modules without manifests)
  try {
    const { loadCodeModeTools } = await import('./codemode-tools')
    await loadCodeModeTools()
  } catch (error) {
    console.error('[MCP Tools] Could not load Code Mode tools:', error)
  }
}
```

### 2.2 Retrieval-Based Module Router

Create `packages/ai-assistant/src/modules/ai_assistant/lib/manifest-router.ts`.

The router selects relevant modules using **keyword matching** on manifest metadata (not an LLM call). This is fast, cheap, and has no single point of failure.

```typescript
import type { AiManifestEntry, AiManifest, AiContextDependency } from '@open-mercato/shared/modules/ai'

export type RouteResult = {
  /** Activated module IDs (primary + dependencies) */
  activeModules: string[]
  /** Manifests for activated modules */
  manifests: AiManifestEntry[]
  /** Why each module was activated */
  activationReasons: Map<string, string>
}

/**
 * Select relevant modules for a user message.
 *
 * Strategy: keyword matching on manifest domain, description, keywords,
 * and data capability entity names. Score each module. Activate top-k
 * plus their contextDependencies (with cycle detection, depth limit 2).
 *
 * Graduates to vector search in a future phase.
 */
export function routeToModules(
  message: string,
  allManifests: AiManifestEntry[],
  options?: {
    maxModules?: number           // default 5
    maxDependencyDepth?: number   // default 2
    currentModule?: string        // from page context — always activated
    userFeatures?: string[]       // for ACL filtering
  }
): RouteResult {
  const maxModules = options?.maxModules ?? 5
  const maxDepth = options?.maxDependencyDepth ?? 2

  // 1. Score each manifest against the message
  const scored = allManifests
    .filter(entry => isAccessible(entry.manifest, options?.userFeatures))
    .map(entry => ({
      entry,
      score: scoreManifest(entry, message),
    }))
    .sort((a, b) => b.score - a.score)

  // 2. Always include search module (universal utility)
  // 3. Always include currentModule if provided
  // 4. Take top-k by score

  const activated = new Map<string, string>() // moduleId → reason

  if (options?.currentModule) {
    activated.set(options.currentModule, 'current page context')
  }

  // Always include search if available
  const searchEntry = allManifests.find(e => e.moduleId === 'search')
  if (searchEntry) {
    activated.set('search', 'universal search capability')
  }

  for (const { entry, score } of scored) {
    if (activated.size >= maxModules) break
    if (score > 0 && !activated.has(entry.moduleId)) {
      activated.set(entry.moduleId, `matched query (score: ${score})`)
    }
  }

  // 5. Resolve contextDependencies (eager, with cycle detection)
  const resolved = resolveContextDependencies(
    Array.from(activated.keys()),
    allManifests,
    maxDepth,
    activated,
  )

  return {
    activeModules: Array.from(resolved.keys()),
    manifests: allManifests.filter(e => resolved.has(e.moduleId)),
    activationReasons: resolved,
  }
}

function scoreManifest(entry: AiManifestEntry, message: string): number {
  const msg = message.toLowerCase()
  const m = entry.manifest
  let score = 0

  // Domain match
  if (msg.includes(m.domain.toLowerCase())) score += 10

  // Keyword match
  for (const kw of m.keywords ?? []) {
    if (msg.includes(kw.toLowerCase())) score += 5
  }

  // Entity name match
  for (const dc of m.dataCapabilities) {
    if (msg.includes(dc.entity.toLowerCase())) score += 8
  }

  // Description word overlap
  const descWords = m.description.toLowerCase().split(/\s+/)
  for (const word of descWords) {
    if (word.length > 3 && msg.includes(word)) score += 1
  }

  return score
}

function resolveContextDependencies(
  initialModules: string[],
  allManifests: AiManifestEntry[],
  maxDepth: number,
  activated: Map<string, string>,
): Map<string, string> {
  const visited = new Set<string>(initialModules)
  let frontier = [...initialModules]

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: string[] = []
    for (const moduleId of frontier) {
      const entry = allManifests.find(e => e.moduleId === moduleId)
      if (!entry?.manifest.contextDependencies) continue

      for (const dep of entry.manifest.contextDependencies) {
        if (visited.has(dep.moduleId)) continue // cycle detection
        visited.add(dep.moduleId)
        nextFrontier.push(dep.moduleId)
        activated.set(dep.moduleId, `dependency of ${moduleId}: ${dep.reason}`)
      }
    }
    frontier = nextFrontier
  }

  return activated
}

function isAccessible(manifest: AiManifest, userFeatures?: string[]): boolean {
  if (!manifest.requiredFeatures?.length) return true
  if (!userFeatures) return false
  return manifest.requiredFeatures.every(f => userFeatures.includes(f))
}
```

### 2.3 Structured Prompt Composer

Create `packages/ai-assistant/src/modules/ai_assistant/lib/prompt-composer.ts`.

Uses a **structured template with named sections** to prevent incoherent prompts when multiple modules are active.

```typescript
import type { AiManifestEntry } from '@open-mercato/shared/modules/ai'

export type PromptContext = {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  userFeatures: string[]
  isSuperAdmin: boolean
  /** Module the user is currently viewing (from page context) */
  currentModule?: string
  currentRecordId?: string
  currentPage?: string
}

/**
 * Compose a system prompt from a structured template and module fragments.
 *
 * Template sections:
 *   [ROLE]          — Base assistant identity and rules
 *   [AUTH CONTEXT]  — Current user, tenant, permissions
 *   [ACTIVE MODULES]— Overview of what modules are available
 *   [MODULE: X]     — Per-module section with tools + systemContext
 *   [GUIDELINES]    — Conversation rules, safety, tool usage limits
 */
export function composeSystemPrompt(
  activeManifests: AiManifestEntry[],
  ctx: PromptContext,
): string {
  const sections: string[] = []

  // ── ROLE ──────────────────────────────────────────────────
  sections.push(`You are an AI assistant for Open Mercato, a business management platform.
You help users manage their business operations by using the tools available to you.
Always be concise and actionable. Prefer using tools over asking clarifying questions when the intent is clear.`)

  // ── AUTH CONTEXT ──────────────────────────────────────────
  sections.push(`## Current Context
- Tenant: ${ctx.tenantId ?? 'unknown'}
- Organization: ${ctx.organizationId ?? 'unknown'}
- User: ${ctx.userId ?? 'unknown'}
- Role: ${ctx.isSuperAdmin ? 'Super Admin' : 'Standard User'}`)

  if (ctx.currentPage) {
    sections.push(`- Current page: ${ctx.currentPage}`)
  }

  // ── ACTIVE MODULES ────────────────────────────────────────
  const moduleList = activeManifests
    .map(e => `- **${e.manifest.domain}** (${e.moduleId}): ${e.manifest.description}`)
    .join('\n')

  sections.push(`## Available Modules\n${moduleList}`)

  // ── PER-MODULE SECTIONS ───────────────────────────────────
  for (const entry of activeManifests) {
    const m = entry.manifest
    if (!m.systemContext) continue

    sections.push(`## ${m.domain} (${entry.moduleId})\n${m.systemContext}`)
  }

  // ── GUIDELINES ────────────────────────────────────────────
  sections.push(`## Guidelines
- For FIND/LIST operations, use GET requests only.
- Before ANY write operation (POST/PUT/DELETE), confirm with the user unless they explicitly asked to change data.
- When searching, prefer the search tools over browsing APIs manually.
- Keep responses concise. Show key data, not raw JSON dumps.
- If a tool call fails, explain the error clearly and suggest a fix.`)

  return sections.join('\n\n')
}
```

### 2.4 Vercel AI SDK Chat Route

Create `packages/ai-assistant/src/modules/ai_assistant/api/chat-v2/route.ts`.

This runs **alongside** the existing OpenCode chat route. Feature-flagged via `AI_CHAT_MODE=native` env var (default: `opencode` for backward compatibility).

```typescript
import { streamText } from 'ai'
import { resolveAndCreateAiModel } from '@open-mercato/shared/lib/ai/model-factory'
import { InProcessMcpClient } from '../../lib/in-process-client'
import { convertMcpToolsToAiSdk } from '../../lib/mcp-tool-adapter'
import { routeToModules } from '../../lib/manifest-router'
import { composeSystemPrompt } from '../../lib/prompt-composer'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

// Load manifests from generated file
let manifestsPromise: Promise<AiManifestEntry[]> | null = null
async function getManifests() {
  if (!manifestsPromise) {
    manifestsPromise = import('@/.mercato/generated/ai-manifests.generated')
      .then(m => m.aiManifestEntries)
      .catch(() => [])
  }
  return manifestsPromise
}

export async function POST(req: Request) {
  // 1. Authenticate (reuse existing session auth pattern)
  const { messages, context } = await req.json()
  const authContext = await authenticateRequest(req)

  // 2. Create in-process client with session auth
  const container = await createRequestContainer()
  const mcpClient = await InProcessMcpClient.createWithAuthContext({
    container,
    authContext,
  })

  // 3. Route: select modules based on last user message
  const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content ?? ''
  const manifests = await getManifests()
  const routeResult = routeToModules(lastUserMessage, manifests, {
    maxModules: 6,
    currentModule: context?.currentModule,
    userFeatures: authContext.userFeatures,
  })

  // 4. Get tools filtered by route result + ACL
  const mcpTools = await mcpClient.listToolsWithSchemas()
  const activeToolNames = new Set(
    routeResult.manifests.flatMap(e => e.manifest.tools.map(t => t.name))
  )
  // Include tools from activated modules + always include context_whoami
  const filteredTools = mcpTools.filter(
    t => activeToolNames.has(t.name) || t.name === 'context_whoami'
  )
  const aiTools = convertMcpToolsToAiSdk(mcpClient, filteredTools)

  // 5. Compose system prompt from module fragments
  const systemPrompt = composeSystemPrompt(routeResult.manifests, {
    tenantId: authContext.tenantId,
    organizationId: authContext.organizationId,
    userId: authContext.userId,
    userFeatures: authContext.userFeatures,
    isSuperAdmin: authContext.isSuperAdmin,
    currentModule: context?.currentModule,
    currentPage: context?.currentPage,
  })

  // 6. Resolve model from user's .env (provider-agnostic)
  const { model } = await resolveAndCreateAiModel({
    preferredTier: 'standard',
  })

  // 7. Stream response
  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    tools: aiTools,
    maxSteps: 10,
  })

  return result.toDataStreamResponse()
}
```

### 2.5 Feature Flag / Route Switching

In the existing chat route dispatcher, check `AI_CHAT_MODE`:

```typescript
const chatMode = process.env.AI_CHAT_MODE ?? 'opencode'
if (chatMode === 'native') {
  return nativeChatHandler(req)  // new Vercel AI SDK route
} else {
  return opencodeChatHandler(req)  // existing OpenCode route
}
```

### Files Created/Modified in Phase 2

| Action | File |
|--------|------|
| MODIFY | `packages/ai-assistant/src/modules/ai_assistant/lib/tool-loader.ts` |
| CREATE | `packages/ai-assistant/src/modules/ai_assistant/lib/manifest-router.ts` |
| CREATE | `packages/ai-assistant/src/modules/ai_assistant/lib/prompt-composer.ts` |
| CREATE | `packages/ai-assistant/src/modules/ai_assistant/api/chat-v2/route.ts` |
| MODIFY | `packages/ai-assistant/src/modules/ai_assistant/api/chat/route.ts` (feature flag) |

---

## Phase 3: Module Manifest Migration

Convert existing `ai-tools.ts` files to richer `ai-manifest.ts` files. Add manifests to core modules.

### 3.1 Example: Search Module

```typescript
// packages/search/src/modules/search/ai-manifest.ts
import type { AiManifest } from '@open-mercato/shared/modules/ai'
import { aiTools } from './ai-tools'

export const aiManifest: AiManifest = {
  domain: 'Search',
  description: 'Hybrid search across all business data — customers, products, orders, deals, and more',
  keywords: ['search', 'find', 'lookup', 'query', 'who', 'what', 'where', 'list'],

  dataCapabilities: [
    {
      entity: 'any',
      description: 'Cross-entity search with fulltext, vector, and token strategies',
      operations: ['search', 'get', 'aggregate'],
      searchableFields: ['name', 'title', 'email', 'phone', 'description'],
    },
  ],

  tools: aiTools,

  systemContext: `Use search_query as your FIRST tool when looking for any record.
It searches across all entity types in one call. Use search_get to fetch full details
after finding a record. Use search_schema to discover what entities and fields are available.`,
}
```

### 3.2 Example: Customers Module (new manifest)

```typescript
// packages/core/src/modules/customers/ai-manifest.ts
import type { AiManifest } from '@open-mercato/shared/modules/ai'

export const aiManifest: AiManifest = {
  domain: 'CRM',
  description: 'Customer relationship management — companies, people, deals, and activities',
  keywords: ['customer', 'company', 'person', 'contact', 'deal', 'pipeline', 'crm', 'client'],

  dataCapabilities: [
    {
      entity: 'company',
      description: 'Business organizations',
      operations: ['list', 'get', 'create', 'update', 'search'],
      searchableFields: ['name', 'email', 'phone', 'industry', 'website'],
      relationships: [
        { entity: 'person', module: 'customers', type: 'hasMany' },
        { entity: 'deal', module: 'customers', type: 'hasMany' },
      ],
    },
    {
      entity: 'person',
      description: 'Individual contacts linked to companies',
      operations: ['list', 'get', 'create', 'update', 'search'],
      searchableFields: ['firstName', 'lastName', 'email', 'phone', 'jobTitle'],
      relationships: [
        { entity: 'company', module: 'customers', type: 'belongsTo' },
      ],
    },
    {
      entity: 'deal',
      description: 'Sales opportunities with pipeline stages',
      operations: ['list', 'get', 'create', 'update'],
      searchableFields: ['title', 'status', 'pipelineStage'],
      relationships: [
        { entity: 'company', module: 'customers', type: 'belongsTo' },
        { entity: 'person', module: 'customers', type: 'belongsTo' },
      ],
    },
  ],

  tools: [
    // Define customers-specific tools here
    // or import from a separate ai-tools.ts
  ],

  systemContext: `When working with customers:
- Always search for existing records before creating new ones to avoid duplicates.
- Companies and people are separate entities linked by company_id.
- Deals represent sales opportunities and have pipeline stages.`,

  requiredFeatures: ['customers.view'],
}
```

### 3.3 Example: Sales Module (new manifest with dependencies)

```typescript
// packages/core/src/modules/sales/ai-manifest.ts
import type { AiManifest } from '@open-mercato/shared/modules/ai'

export const aiManifest: AiManifest = {
  domain: 'Sales',
  description: 'Quotes, orders, invoices, shipments, and payments',
  keywords: ['quote', 'order', 'invoice', 'shipment', 'payment', 'sale', 'price', 'billing'],

  contextDependencies: [
    { moduleId: 'customers', reason: 'Sales documents reference companies/people', required: true },
    { moduleId: 'catalog', reason: 'Line items reference products for pricing', required: true },
    { moduleId: 'search', reason: 'Finding customers and products by name', required: false },
  ],

  dataCapabilities: [
    {
      entity: 'quote',
      description: 'Sales quotations with line items and pricing',
      operations: ['list', 'get', 'create', 'update'],
      searchableFields: ['number', 'status', 'customerName'],
      relationships: [
        { entity: 'company', module: 'customers', type: 'belongsTo' },
        { entity: 'product', module: 'catalog', type: 'hasMany' },
      ],
    },
    {
      entity: 'order',
      description: 'Sales orders confirmed from quotes',
      operations: ['list', 'get', 'create', 'update'],
      searchableFields: ['number', 'status'],
    },
    {
      entity: 'invoice',
      description: 'Billing documents generated from orders',
      operations: ['list', 'get', 'create'],
      searchableFields: ['number', 'status', 'dueDate'],
    },
  ],

  tools: [],  // Phase 3 — add sales-specific tools

  systemContext: `When creating sales documents (quotes, orders, invoices):
1. Always search for the customer first using search_query.
2. Search for products to get correct IDs and current pricing.
3. Line items require: productId, quantity, unitPrice.
4. The customerId field expects a company or person UUID from the customers module.
5. Quotes can be converted to orders, and orders to invoices.`,

  requiredFeatures: ['sales.view'],
  preferredModelTier: 'standard',
}
```

### Modules to Add Manifests

| Module | Priority | Has ai-tools.ts | Notes |
|--------|----------|-----------------|-------|
| search | P0 | Yes | Universal utility, always activated |
| inbox_ops | P1 | No (stale ref) | ai-tools.ts deleted; fresh manifest needed (see V3) |
| customers | P1 | No | Core CRM, most queries involve customers |
| sales | P1 | No | Complex with cross-module dependencies |
| catalog | P1 | No | Products/pricing, needed by sales |
| auth | P2 | No | User/role management |
| dictionaries | P2 | No | Configurable values |

---

## Phase 4: Remove OpenCode

After the native chat route is stable and feature-flagged on:

1. Set `AI_CHAT_MODE=native` as default
2. Remove `opencode-client.ts`
3. Remove `opencode-handlers.ts`
4. Remove OpenCode-related env vars from `.env.example`
5. Remove `codemode-tools.ts` and `sandbox.ts` (Code Mode)
6. Remove `session-memory.ts` (rebuild on Vercel AI SDK if needed)
7. Update `cli.ts` to remove any OpenCode-specific commands
8. Clean up `api/chat/route.ts` to only use native path
9. Remove `@modelcontextprotocol/sdk` from dependencies (if MCP server for external tools is refactored to not need it — otherwise keep)

---

## Phase 5: Advanced (Future)

To be implemented incrementally after Phase 4 is stable. Each sub-phase is independent and can be prioritized based on user needs.

---

### 5.1 Page Context Resolver

**Problem:** The AI doesn't know what the user is looking at. A user on `/backend/sales/quotes/abc-123` asking "summarize this" gets no useful answer because the AI has no record-level context.

**Existing infrastructure:** The frontend already has `usePageContext()` (in `ai-assistant/src/frontend/hooks/usePageContext.ts`) which extracts `{ module, entityType, recordId }` from the URL and passes it in the chat request body as `context`. The chat route receives this but doesn't use it.

**Proposal:** Add a `pageContextResolver` function to `AiManifest` that loads record-level context when a user is viewing a specific page in that module.

```typescript
// Extension to AiManifest
export type AiManifest = {
  // ... existing fields ...

  /**
   * Resolve page-level context when the user is on a page owned by this module.
   * Called once when the chat opens (or when the page changes mid-conversation).
   * Returns a text block injected into the system prompt as [CURRENT RECORD] section.
   */
  pageContextResolver?: (ctx: {
    entityType: string
    recordId: string
    container: AwilixContainer
    tenantId: string | null
    organizationId: string | null
  }) => Promise<string | null>
}
```

**Example — Sales module:**

```typescript
// packages/core/src/modules/sales/ai-manifest.ts
export const aiManifest: AiManifest = {
  // ...
  pageContextResolver: async ({ entityType, recordId, container }) => {
    if (entityType === 'quotes') {
      const em = container.resolve<EntityManager>('em')
      const quote = await em.findOne('Quote', recordId, {
        populate: ['lineItems', 'customer', 'assignedUser'],
      })
      if (!quote) return null
      return `The user is viewing Quote #${quote.number} (${quote.status}).
Customer: ${quote.customer?.name ?? 'Unknown'}
Total: ${quote.totalAmount} ${quote.currency}
Line items: ${quote.lineItems.length}
Created: ${quote.createdAt.toISOString()}
Assigned to: ${quote.assignedUser?.displayName ?? 'Unassigned'}`
    }
    return null
  },
}
```

**Chat route integration (Phase 2.4 update):**

```typescript
// After routing, before composing the system prompt:
if (context?.module && context?.recordId) {
  const moduleManifest = routeResult.manifests.find(e => e.moduleId === context.module)
  if (moduleManifest?.manifest.pageContextResolver) {
    const recordContext = await moduleManifest.manifest.pageContextResolver({
      entityType: context.entityType,
      recordId: context.recordId,
      container,
      tenantId: authContext.tenantId,
      organizationId: authContext.orgId,
    })
    if (recordContext) {
      // Inject as a named section in the prompt
      promptContext.currentRecordContext = recordContext
    }
  }
}
```

**Prompt composer addition — new [CURRENT RECORD] section between AUTH CONTEXT and ACTIVE MODULES:**

```
## Current Record
The user is viewing Quote #Q-2024-0847 (draft).
Customer: Acme Corp
Total: 12,500.00 EUR
...
```

**Files:**

| Action | File |
|--------|------|
| MODIFY | `packages/shared/src/modules/ai.ts` (add `pageContextResolver` to `AiManifest`) |
| MODIFY | `prompt-composer.ts` (add `[CURRENT RECORD]` section) |
| MODIFY | `chat-v2/route.ts` (call resolver before composing prompt) |
| CREATE | Per-module resolvers in each module's `ai-manifest.ts` |

---

### 5.2 Cross-Module Context Provider

**Problem:** Module A's tool needs data from module B, but there's no standard interface. Currently, tools use ad-hoc DI resolution (`container.resolve('someService')`), which is fragile and creates hidden coupling.

**Existing infrastructure:** Awilix DI container is request-scoped. Modules already register services via `di.ts`. The `resolveCrossModuleEntities()` pattern in `inbox_ops/ai-tools.ts` demonstrates the need.

**Proposal:** Each module declares a typed `contextProvider` — a standard interface other modules can call to get structured data.

```typescript
// Extension to AiManifest
export type AiManifest = {
  // ... existing fields ...

  /**
   * Standard interface for other modules to request context.
   * Supports typed entity lookups, counts, and summaries.
   */
  contextProvider?: AiContextProvider
}

export type AiContextProvider = {
  /** Resolve a single entity by type and ID */
  getEntity?: (entityType: string, id: string, ctx: AiToolContext) => Promise<Record<string, unknown> | null>

  /** Search entities with a text query */
  searchEntities?: (entityType: string, query: string, ctx: AiToolContext) => Promise<Array<{ id: string; label: string; score?: number }>>

  /** Get a summary of recent activity */
  getRecentActivity?: (entityType: string, ctx: AiToolContext) => Promise<string | null>
}
```

**Example — Customers module providing context to Sales:**

```typescript
// packages/core/src/modules/customers/ai-manifest.ts
export const aiManifest: AiManifest = {
  // ...
  contextProvider: {
    getEntity: async (entityType, id, ctx) => {
      const em = ctx.container.resolve<EntityManager>('em')
      if (entityType === 'company') {
        const company = await em.findOne('Company', id, { populate: ['primaryContact'] })
        return company ? { id: company.id, name: company.name, email: company.email, phone: company.phone, primaryContact: company.primaryContact?.displayName } : null
      }
      if (entityType === 'person') {
        const person = await em.findOne('Person', id)
        return person ? { id: person.id, name: `${person.firstName} ${person.lastName}`, email: person.email, company: person.companyId } : null
      }
      return null
    },
    searchEntities: async (entityType, query, ctx) => {
      const searchService = ctx.container.resolve<SearchService>('searchService')
      const results = await searchService.search(query, { entityTypes: [entityType], limit: 5 })
      return results.map(r => ({ id: r.recordId, label: r.presenter?.title ?? r.recordId, score: r.score }))
    },
  },
}
```

**Usage from another module's tool:**

```typescript
// In a sales tool handler:
async function createQuoteTool(input: CreateQuoteInput, ctx: AiToolContext) {
  // Resolve customer via cross-module context provider
  const manifests = getAiManifests()
  const customersManifest = manifests.find(m => m.moduleId === 'customers')
  const customer = await customersManifest?.manifest.contextProvider?.getEntity('company', input.customerId, ctx)
  if (!customer) throw new Error(`Customer ${input.customerId} not found`)
  // ... proceed with quote creation using customer data
}
```

**Files:**

| Action | File |
|--------|------|
| MODIFY | `packages/shared/src/modules/ai.ts` (add `AiContextProvider` type, add to `AiManifest`) |
| CREATE | Per-module `contextProvider` implementations in `ai-manifest.ts` |

---

### 5.3 Vector-Based Routing

**Problem:** Keyword matching (Phase 2) is fast but brittle. "Show me what John owes" should route to both customers (to find John) and sales (for invoices), but keyword matching might miss this because neither "owes" nor "John" appear in manifest metadata.

**Existing infrastructure:** The codebase has a production-grade hybrid search service:
- `SearchService` with parallel strategy execution (fulltext, vector, tokens)
- `EmbeddingService` supporting OpenAI, Google, Mistral, Cohere, Bedrock, Ollama
- Pluggable vector drivers: pgvector, Qdrant, ChromaDB
- `ToolSearchService` already does hybrid search over tool descriptions with RRF merging
- `VectorEntityConfig` with `buildSource` for custom embedding content

**Proposal:** Index manifest metadata as a searchable entity type, then use hybrid search to replace keyword scoring.

```typescript
// New entity type for search indexing
const AI_MANIFEST_ENTITY = 'ai:module_manifest' as EntityId

// Register manifest indexing during bootstrap
export function indexManifestsForSearch(
  searchService: SearchService,
  manifests: AiManifestEntry[],
): Promise<void> {
  for (const entry of manifests) {
    const m = entry.manifest
    // Build rich text for embedding
    const content = [
      `Module: ${m.domain}`,
      `Description: ${m.description}`,
      `Keywords: ${(m.keywords ?? []).join(', ')}`,
      `Entities: ${m.dataCapabilities.map(d => `${d.entity} (${d.description})`).join('; ')}`,
      m.systemContext ?? '',
    ].join('\n')

    await searchService.upsert(AI_MANIFEST_ENTITY, entry.moduleId, {
      title: m.domain,
      content,
      metadata: {
        moduleId: entry.moduleId,
        keywords: m.keywords,
        entities: m.dataCapabilities.map(d => d.entity),
      },
    })
  }
}
```

**Updated router — replace `scoreManifest()` with hybrid search:**

```typescript
// manifest-router.ts — Phase 5 upgrade
export async function routeToModulesV2(
  message: string,
  allManifests: AiManifestEntry[],
  searchService: SearchService,
  options?: RouteOptions,
): Promise<RouteResult> {
  // 1. Hybrid search over manifest index
  const searchResults = await searchService.search(message, {
    entityTypes: [AI_MANIFEST_ENTITY],
    limit: options?.maxModules ?? 5,
    strategies: ['fulltext', 'vector', 'tokens'],
  })

  // 2. Map search results back to manifests
  const activated = new Map<string, string>()
  for (const result of searchResults) {
    const moduleId = result.recordId
    activated.set(moduleId, `semantic match (score: ${result.score.toFixed(2)})`)
  }

  // 3. Always include currentModule + search (same as Phase 2)
  // 4. Resolve contextDependencies (same as Phase 2)
  // ...
}
```

**Strategy weights for manifest routing (tuned differently from general search):**

| Strategy | Weight | Rationale |
|----------|--------|-----------|
| vector (semantic) | 1.5 | Catches intent even when wording differs from keywords |
| fulltext | 1.0 | Fast exact matching for domain terms |
| tokens | 0.5 | Backup for partial matches |

**Fallback:** If no search results score above the threshold (0.2), fall back to keyword routing (Phase 2 logic). This ensures the system degrades gracefully if vector search is misconfigured or embeddings are stale.

**Files:**

| Action | File |
|--------|------|
| CREATE | `packages/ai-assistant/src/modules/ai_assistant/lib/manifest-index.ts` |
| MODIFY | `manifest-router.ts` (add `routeToModulesV2`, keep `routeToModules` as fallback) |
| MODIFY | `bootstrap.ts` (call `indexManifestsForSearch` after registering manifests) |

---

### 5.4 Module-Scoped Agents

**Problem:** Some tasks require deeper reasoning within a single domain — multi-step sales workflows (find customer → check inventory → create quote → apply pricing rules) benefit from a specialized agent loop rather than a general-purpose one-shot.

**Existing infrastructure:** The codebase has `agentic/` directories in core, search, and create-app packages with skill definitions for various domains (code-review, spec-writing, module-scaffold, etc.). The `streamText()` call in Phase 2 already supports `maxSteps` for multi-turn tool calling.

**Proposal:** Modules declare an optional `agentConfig` in their manifest for domain-deep tasks.

```typescript
// Extension to AiManifest
export type AiManifest = {
  // ... existing fields ...

  /**
   * Specialized agent configuration for deep domain tasks.
   * When a user's request is clearly scoped to this module and requires
   * multi-step reasoning, the chat route can switch to this agent config.
   */
  agentConfig?: {
    /** Override model tier for this agent (e.g., 'powerful' for complex sales workflows) */
    preferredModelTier: 'fast' | 'standard' | 'powerful'
    /** Maximum tool call steps for this agent */
    maxSteps: number
    /** Additional system prompt for agent mode (appended to module's systemContext) */
    agentInstructions: string
    /** Trigger phrases that activate agent mode instead of one-shot */
    triggerPatterns?: string[]
  }
}
```

**Example — Sales agent for quote creation workflows:**

```typescript
// packages/core/src/modules/sales/ai-manifest.ts
export const aiManifest: AiManifest = {
  // ...
  agentConfig: {
    preferredModelTier: 'powerful',
    maxSteps: 15,
    agentInstructions: `You are in Sales Agent mode. Follow this workflow:
1. ALWAYS search for the customer first. Never assume customer IDs.
2. Search for products to get current pricing.
3. Build the quote line by line, confirming each item with the user.
4. Apply any applicable discounts from the pricing rules.
5. Present a summary before creating the quote.
6. After creation, offer to convert to order if appropriate.`,
    triggerPatterns: ['create a quote', 'new quote for', 'prepare an offer', 'build a proposal'],
  },
}
```

**Chat route integration:**

```typescript
// In chat-v2/route.ts, after routing:
const primaryModule = routeResult.manifests[0]
const agentConfig = primaryModule?.manifest.agentConfig
const isAgentMode = agentConfig?.triggerPatterns?.some(
  pattern => lastUserMessage.toLowerCase().includes(pattern)
)

const { model } = await resolveAndCreateAiModel({
  preferredTier: isAgentMode
    ? agentConfig.preferredModelTier
    : primaryModule?.manifest.preferredModelTier ?? 'standard',
})

const result = streamText({
  model,
  system: isAgentMode
    ? systemPrompt + '\n\n## Agent Mode\n' + agentConfig.agentInstructions
    : systemPrompt,
  messages,
  tools: aiTools,
  maxSteps: isAgentMode ? agentConfig.maxSteps : 10,
})
```

**Files:**

| Action | File |
|--------|------|
| MODIFY | `packages/shared/src/modules/ai.ts` (add `agentConfig` to `AiManifest`) |
| MODIFY | `chat-v2/route.ts` (agent mode detection and config override) |
| CREATE | Per-module agent configs in `ai-manifest.ts` |

---

### 5.5 Streaming Tool Progress

**Problem:** Multi-step tool calls take time. The user sees "thinking..." for 10+ seconds with no visibility into what's happening.

**Existing infrastructure:** The SSE streaming system already supports these event types: `thinking`, `text`, `tool-call`, `tool-result`, `metadata`, `debug`, `done`, `error`. The Vercel AI SDK's `streamText()` emits tool call events natively.

**Proposal:** Wire Vercel AI SDK's streaming events into the existing SSE format, adding progress indicators.

```typescript
// In chat-v2/route.ts — stream with tool progress events
const result = streamText({
  model,
  system: systemPrompt,
  messages,
  tools: aiTools,
  maxSteps: isAgentMode ? agentConfig.maxSteps : 10,
  onStepStart: async ({ stepNumber, toolCalls }) => {
    // Emit progress event for each step
    for (const tc of toolCalls ?? []) {
      await writeSSE({
        type: 'tool-call',
        id: tc.toolCallId,
        toolName: tc.toolName,
        args: tc.args,
        step: stepNumber,
      })
    }
  },
  onStepFinish: async ({ stepNumber, toolResults }) => {
    for (const tr of toolResults ?? []) {
      await writeSSE({
        type: 'tool-result',
        id: tr.toolCallId,
        result: tr.result,
        step: stepNumber,
      })
    }
  },
})

// Stream text chunks
for await (const chunk of result.textStream) {
  await writeSSE({ type: 'text', content: chunk })
}

await writeSSE({
  type: 'metadata',
  model: modelWithProvider,
  provider: providerId,
  tokens: await result.usage,
})
await writeSSE({ type: 'done' })
```

**Frontend updates (extend `ChatSSEEvent`):**

```typescript
// Add step tracking to existing event types
| { type: 'tool-call'; id: string; toolName: string; args: unknown; step?: number }
| { type: 'tool-result'; id: string; result: unknown; step?: number }
| { type: 'step-progress'; step: number; totalSteps: number; status: 'running' | 'complete' }
```

**UI rendering:** The frontend can show a collapsible "Steps" panel showing each tool call in progress, similar to how ChatGPT shows "Searching..." or "Running code...".

**Files:**

| Action | File |
|--------|------|
| MODIFY | `chat-v2/route.ts` (add streaming callbacks) |
| MODIFY | `frontend/types.ts` (extend `ChatSSEEvent` with step tracking) |
| MODIFY | Frontend chat components (render tool progress) |

---

### 5.6 API Whitelist Auto-Tools

**Problem:** Manually writing CRUD tools for every module entity is unsustainable. The codebase already has a rich OpenAPI spec that Code Mode exposes via `search`/`execute`. We need the specificity of discrete tools without the maintenance burden of hand-writing them.

**Existing infrastructure:**
- `getCodeModeSpec()` merges OpenAPI paths + entity graph
- `spec.findEndpoints(keyword)` discovers endpoints by path/tag
- `spec.describeEndpoint(path, method)` returns typed field info, examples, and related endpoints
- `getRawOpenApiSpec()` returns the full OpenAPI JSON

**Proposal:** Modules declare which OpenAPI endpoints should be auto-generated as discrete AI tools. The system converts each whitelisted endpoint into a typed tool at startup.

```typescript
// Extension to AiManifest
export type AiManifest = {
  // ... existing fields ...

  /**
   * OpenAPI endpoints to auto-generate as discrete AI tools.
   * Each entry becomes a separate tool with typed input schema from the OpenAPI spec.
   * Replaces the need for Code Mode's generic execute tool for covered endpoints.
   */
  apiWhitelist?: AiApiWhitelistEntry[]
}

export type AiApiWhitelistEntry = {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** OpenAPI path (exact or glob pattern) */
  path: string
  /** Override the auto-generated tool name */
  toolName?: string
  /** Override the auto-generated description */
  description?: string
  /** Restrict which fields are exposed in the input schema */
  includeFields?: string[]
  /** Hide sensitive fields from the AI */
  excludeFields?: string[]
  /** Required ACL features (overrides module-level) */
  requiredFeatures?: string[]
}
```

**Example — Sales module whitelisting quote CRUD:**

```typescript
// packages/core/src/modules/sales/ai-manifest.ts
export const aiManifest: AiManifest = {
  domain: 'Sales',
  // ...
  apiWhitelist: [
    { method: 'GET', path: '/api/sales/quotes', description: 'List quotes with filters' },
    { method: 'GET', path: '/api/sales/quotes/:id', description: 'Get quote details with line items' },
    { method: 'POST', path: '/api/sales/quotes', description: 'Create a new quote',
      excludeFields: ['internalNotes', 'auditLog'] },
    { method: 'PUT', path: '/api/sales/quotes', description: 'Update an existing quote' },
    { method: 'GET', path: '/api/sales/orders', description: 'List orders' },
    { method: 'GET', path: '/api/sales/orders/:id', description: 'Get order details' },
    { method: 'GET', path: '/api/sales/invoices', description: 'List invoices' },
  ],
  tools: [],  // Auto-generated tools replace manual ones
}
```

**Auto-tool generator — converts whitelist entries to AI SDK tools at startup:**

```typescript
// packages/ai-assistant/src/modules/ai_assistant/lib/api-whitelist-tools.ts
import { getCodeModeSpec } from './codemode-tools'

export async function generateWhitelistTools(
  whitelist: AiApiWhitelistEntry[],
  moduleId: string,
): Promise<AiToolDefinition[]> {
  const spec = await getCodeModeSpec()
  const tools: AiToolDefinition[] = []

  for (const entry of whitelist) {
    const endpoint = spec.describeEndpoint(entry.path, entry.method.toLowerCase())
    if (!endpoint) continue

    // Build Zod schema from OpenAPI spec fields
    const fields = endpoint.requiredFields
      .concat(endpoint.optionalFields.map(f => ({ name: f, type: 'string' })))
      .filter(f => !entry.excludeFields?.includes(f.name))
      .filter(f => !entry.includeFields || entry.includeFields.includes(f.name))

    const inputSchema = buildZodFromFields(fields, endpoint)

    const toolName = entry.toolName ?? `${moduleId}_${entry.method.toLowerCase()}_${pathToName(entry.path)}`

    tools.push({
      name: toolName,
      description: entry.description ?? `${entry.method} ${entry.path}`,
      inputSchema,
      requiredFeatures: entry.requiredFeatures,
      handler: async (input, ctx) => {
        // Execute via the same api.request() pattern as Code Mode
        return await apiRequest({
          method: entry.method,
          path: resolvePathParams(entry.path, input),
          query: entry.method === 'GET' ? input : undefined,
          body: entry.method !== 'GET' ? input : undefined,
          sessionToken: ctx.sessionId,
        })
      },
    })
  }

  return tools
}
```

**Key advantage:** Modules get discrete, well-named tools (e.g., `sales_get_quotes`, `sales_create_quote`) without hand-writing handlers — the OpenAPI spec provides the schema, and the existing `api.request()` infrastructure provides execution. The AI sees specific tools instead of one opaque `execute` meta-tool, dramatically improving tool selection accuracy.

**Files:**

| Action | File |
|--------|------|
| MODIFY | `packages/shared/src/modules/ai.ts` (add `apiWhitelist`, `AiApiWhitelistEntry`) |
| CREATE | `packages/ai-assistant/src/modules/ai_assistant/lib/api-whitelist-tools.ts` |
| MODIFY | `tool-loader.ts` (call `generateWhitelistTools()` during loading) |
| CREATE | Per-module `apiWhitelist` entries in `ai-manifest.ts` |

---

### Phase 5 Priority Order

| Sub-phase | Impact | Effort | Depends On | Recommended Priority |
|-----------|--------|--------|------------|---------------------|
| 5.5 Streaming tool progress | High UX | Low | Phase 2 only | P0 — ship with Phase 2 |
| 5.1 Page context resolver | High relevance | Medium | Phase 2 + 3 | P1 — ship with Phase 3 |
| 5.6 API whitelist auto-tools | High velocity | High | Phase 2 + Code Mode spec | P1 — enables Phase 4 deletion |
| 5.3 Vector-based routing | Medium accuracy | Medium | Phase 3 + search infra | P2 |
| 5.4 Module-scoped agents | Medium depth | Low | Phase 3 | P2 |
| 5.2 Cross-module context provider | Low (DI works) | Medium | Phase 3 | P3 — only if DI pattern becomes painful |

---

## Environment Variables

```bash
# ─── Provider Selection ──────────────────────────────────
AI_PROVIDER=anthropic              # or: openai, google
AI_MODEL=                          # optional global model override
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...              # optional, for OpenAI provider
GOOGLE_GENERATIVE_AI_API_KEY=...   # optional, for Google provider

# Legacy (supported as fallback)
OPENCODE_PROVIDER=                 # → AI_PROVIDER
OPENCODE_MODEL=                    # → AI_MODEL

# ─── Chat Mode ───────────────────────────────────────────
AI_CHAT_MODE=native                # 'native' (Vercel AI SDK) or 'opencode' (legacy)

# ─── Per-Module Model Overrides (optional) ───────────────
INBOX_OPS_AI_MODEL=claude-haiku-4-5-20251001   # fast model for classification
SALES_AI_MODEL=claude-sonnet-4-20250514        # better model for sales ops

# ─── Router Configuration ────────────────────────────────
AI_ROUTER_MAX_MODULES=6            # max modules activated per query
AI_ROUTER_MAX_DEPTH=2              # max contextDependency depth
```

---

## Backward Compatibility

This spec follows the project's deprecation protocol:

| Surface | Classification | Impact |
|---------|---------------|--------|
| `Module` type | ADDITIVE | New optional `aiManifest` field — no existing code breaks |
| `ai-tools.ts` convention | PRESERVED | Auto-wrapped into minimal manifests by generator |
| `opencode-provider.ts` exports | DEPRECATED | Old functions become thin wrappers, removed after 1 minor version |
| `OPENCODE_*` env vars | DEPRECATED | Checked as fallback in new resolution chain |
| MCP server | UNCHANGED | Stays as external integration surface |
| Tool registry | UNCHANGED | Same `registerMcpTool()` / `getToolRegistry()` API |
| InProcessMcpClient | UNCHANGED | Already built, just wired into new chat route |
| Chat API endpoint | VERSIONED | New route runs alongside existing, controlled by `AI_CHAT_MODE` |

---

## Test Strategy

### Unit Tests

- `ai-provider.ts`: Resolution priority chain (per-module env → global → legacy → tier default)
- `manifest-router.ts`: Scoring, dependency resolution, cycle detection, ACL filtering
- `prompt-composer.ts`: Template structure, module fragment injection, context injection
- `model-factory.ts`: Dynamic import for each provider, error handling

### Integration Tests

- End-to-end chat with native mode: send message → tools selected → response streamed
- Module tool loading: verify tools from `ai-tools.generated.ts` are registered and callable
- Cross-module dependency: sales query activates customers + catalog
- ACL enforcement: tools filtered by user features
- Provider switching: change `AI_PROVIDER`, verify different model used

### Migration Validation

- Feature flag toggle: switch between `opencode` and `native` modes
- Compare response quality: same queries, same tools, both modes
- Performance benchmark: latency comparison (OpenCode vs native)

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Keyword routing misses relevant modules | Always include `search` module; fallback to all modules if no match scores > 0 |
| System prompt becomes incoherent with 5+ modules | Structured template with named sections; token budget per module section |
| Tool naming conflicts across modules | Convention enforced: `{module}_{action}` prefix (existing pattern) |
| contextDependencies create activation cascades | Depth limit (default 2) + cycle detection + max modules cap |
| Vercel AI SDK behavior differs from OpenCode | Feature flag allows A/B comparison; both paths use same tool registry |
| Provider API differences affect tool calling | Vercel AI SDK abstracts this; model tier system maps to appropriate models |
| Model tier mapping becomes stale | Tier defaults in `AI_PROVIDERS` are easily updated; user can always override via env |

---

## Verification Notes (Consensus: Claude Opus + Gemini 3 Pro neutral 9/10 + adversarial 9/10)

Verified against develop branch (commit ca9984fcd). All three reviewers confirmed the architecture is **sound** but the spec code has **critical implementation bugs** that must be fixed before coding begins.

### CRITICAL BLOCKERS

### C1. Auth Context Hydration Bug (unanimous)

The spec's Phase 2.4 chat route passes `authContext.userFeatures` and `authContext.isSuperAdmin` directly from `getAuthFromRequest()`. But that function returns `{ sub, tenantId, orgId, email, roles, isApiKey }` — it does **not** provide `userFeatures`, `userId`, or `isSuperAdmin`. Passing these would yield `undefined`, completely breaking tool ACL enforcement.

**Resolution:** The chat route must:
1. Call `getAuthFromRequest(req)` to get the base auth context
2. Resolve `rbacService` from the DI container
3. Call `rbacService.loadAcl(auth.sub, { tenantId: auth.tenantId, organizationId: auth.orgId })` to hydrate `userFeatures`
4. Map `auth.sub` → `userId`, `auth.orgId` → `organizationId`
5. Determine `isSuperAdmin` from roles or features

This mirrors the existing chat route which calls `getUserRoleIds()` before creating the session API key.

### C2. `@/` Import Path Blocker (unanimous)

The spec uses `import('@/.mercato/generated/ai-manifests.generated')` in Phase 2.1 (tool-loader.ts) and Phase 2.4 (chat route). The `@/` path alias is configured **only** in `apps/mercato/tsconfig.json`. The `packages/ai-assistant/tsconfig.json` has no path mappings.

**Resolution:** Follow the existing DI registrar pattern (`registerDiRegistrars` / `getDiRegistrars()`):
1. Create `registerAiManifests()` / `getAiManifests()` in `packages/shared/src/modules/ai.ts`
2. In `apps/mercato/src/bootstrap.ts`, import the generated file and call `registerAiManifests(aiManifestEntries)`
3. In the chat route, call `getAiManifests()` — no `@/` import needed

Alternatively, register manifests as `aiManifestEntries` in the DI container during bootstrap.

### C3. Catastrophic Capability Regression (adversarial raised, confirmed)

Phase 2's chat route filters tools strictly to active manifest tool names. Phase 3 ships customers, sales, catalog with `tools: []`. With Code Mode `execute`/`search` tools filtered out, the AI would **lose all ability** to interact with CRM, Sales, and Catalog modules — a severe user-facing regression.

**Resolution:** Phase 2.4's `filteredTools` must always include Code Mode `search` + `execute` tools as a fallback:

```typescript
// Always include Code Mode tools as fallback for unmigrated modules
const filteredTools = mcpTools.filter(
  t => activeToolNames.has(t.name) || t.name === 'context_whoami'
    || t.name === 'search' || t.name === 'execute'  // Code Mode fallback
)
```

Remove this fallback only in Phase 4 when Code Mode is deleted and all modules have real tools.

### IMPORTANT FIXES

### I1. AiToolDefinition Type Collision

`AiToolDefinition` already exists in `packages/ai-assistant/src/modules/ai_assistant/lib/types.ts` as an alias for `McpToolDefinition`. It's exported via `@open-mercato/ai-assistant/types` and consumed by voice_channels and other modules.

**Resolution:** Do NOT create a duplicate type in `shared/modules/ai.ts`. Instead:
- Phase 1: Import and re-export the existing type from `@open-mercato/ai-assistant/types`
- Phase 3: Move the canonical definition to `shared/modules/ai.ts`, update ai-assistant to re-export from shared (single source of truth)

### I2. Legacy Wrapper Generation is Brittle

Phase 1.4 proposes static CLI generation of wrapper manifests for modules with `ai-tools.ts` but no `ai-manifest.ts`. This requires the CLI to parse module `index.ts` to extract metadata — fragile and error-prone.

**Resolution:** Handle at runtime instead. In `manifest-router.ts`, merge `aiToolConfigEntries` (from existing ai-tools.generated.ts) with `aiManifestEntries` (from new ai-manifests.generated.ts). Modules with only ai-tools.ts get a minimal runtime manifest:

```typescript
function mergeWithLegacyTools(
  manifests: AiManifestEntry[],
  legacyTools: AiToolConfigEntry[]
): AiManifestEntry[] {
  const manifestModules = new Set(manifests.map(m => m.moduleId))
  for (const entry of legacyTools) {
    if (!manifestModules.has(entry.moduleId)) {
      manifests.push({
        moduleId: entry.moduleId,
        manifest: { domain: entry.moduleId, description: '', keywords: [entry.moduleId], dataCapabilities: [], tools: entry.tools }
      })
    }
  }
  return manifests
}
```

### I3. Prompt Recipe Preservation

The current `CHAT_SYSTEM_INSTRUCTIONS` in `chat/route.ts` (lines 19-100) contains essential CRUD recipes specific to Open Mercato:
- PUT path = collection path, id in BODY (not URL)
- Confirmation required before any write operation
- Maximum 4 tool calls per message (hard limit 10)
- Specific patterns for FIND/LIST, UPDATE, CREATE operations

The spec's `prompt-composer.ts` has a generic GUIDELINES section that does **not** include these vital recipes.

**Resolution:** Port the existing CRUD recipes into the GUIDELINES section of `prompt-composer.ts`. These are platform-specific conventions that the AI must know regardless of which modules are active.

### I4. `inbox_ops/ai-tools.ts` Status Correction

V3 (from previous verification) stated inbox_ops/ai-tools.ts was deleted. This is **incorrect** on develop branch — the file exists with 4 tools: `inbox_ops_list_proposals`, `inbox_ops_get_proposal`, `inbox_ops_accept_action`, `inbox_ops_categorize_email`.

**Resolution:** The Phase 3 migration table is corrected below:

| Module | Priority | Has ai-tools.ts | Notes |
|--------|----------|-----------------|-------|
| search | P0 | Yes (6 tools) | Universal utility, always activated |
| inbox_ops | P0 | Yes (4 tools) | Existing tools, add manifest wrapper |
| customers | P1 | No | Core CRM, most queries involve customers |
| sales | P1 | No | Complex with cross-module dependencies |
| catalog | P1 | No | Products/pricing, needed by sales |
| auth | P2 | No | User/role management |
| dictionaries | P2 | No | Configurable values |

### STRATEGIC RECOMMENDATIONS (Phase 5 additions)

### S1. API Whitelist for Auto-Generated Tools

The adversarial review correctly identified that manually writing CRUD tools for every module entity is unsustainable. The codebase already has a rich OpenAPI spec.

**Proposal for Phase 5:** Extend `AiManifest` with an `apiWhitelist` field:

```typescript
export type AiManifest = {
  // ... existing fields ...
  /** OpenAPI endpoints to auto-generate as discrete AI tools */
  apiWhitelist?: Array<{
    method: 'GET' | 'POST' | 'PUT' | 'DELETE'
    pathPattern: string  // e.g., '/api/sales/quotes*'
    description?: string
  }>
}
```

This allows modules to expose specific OpenAPI endpoints as auto-generated tools — keeping the benefits of the OpenAPI spec without the opacity of Code Mode's single `execute` tool.

---

## Changelog

- 2026-04-11: Initial spec. Consensus with Gemini 2.5 Pro (neutral + adversarial).
  - Adopted: retrieval-based single-phase routing (not LLM planner)
  - Adopted: simplified v1 manifest (defer pageContextResolver, contextProvider)
  - Adopted: structured prompt template with named sections
  - Adopted: eager contextDependency activation with cycle detection
- 2026-04-11: Verification pass against codebase. Added 4 verification notes (V1–V4).
- 2026-04-11: Consensus verification on develop branch (ca9984fcd) with Gemini 3 Pro (neutral 9/10, adversarial 9/10).
  - Identified 3 critical blockers: auth hydration bug, @/ import blocker, capability regression
  - Identified 4 important fixes: type collision, legacy wrapper brittleness, prompt recipe preservation, inbox_ops status
  - Added strategic recommendation: apiWhitelist for Phase 5
  - Corrected Phase 3 migration table (inbox_ops confirmed present on develop)
  - Replaced V1-V4 notes with comprehensive C1-C3, I1-I4, S1 findings
