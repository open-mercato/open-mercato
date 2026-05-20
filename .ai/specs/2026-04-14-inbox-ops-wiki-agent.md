# Inbox-Ops Wiki Agent

| Field | Value |
|-------|-------|
| **Status** | Approved |
| **Created** | 2026-04-14 |
| **App Spec** | `2026-04-14-inbox-ops-lead-intake-app-spec.md` |
| **Related Specs** | `2026-04-14-inbox-ops-knowledge-base.md` (Spec 2 — KB entity + CRUD API), `2026-04-14-inbox-ops-auto-approval.md` (Spec 4 — Decision Trace) |
| **Depends On** | Spec 2 (Knowledge Base entity + CRUD API must exist) |
| **Blocked By** | — |

## TLDR

Add a conversational AI agent to the proposal detail page that can read/write Knowledge Base pages, inspect proposals, and search CRM contacts. The agent's system prompt is itself a KB page (`agent_prompt` category), making agent behavior tenant-customizable. Implements a self-contained chat API route (`POST /api/inbox-ops/agent/chat`) using Vercel AI SDK `streamText` with 7 scoped tools. Also exports tools via the existing `ai-tools.ts` pattern for MCP compatibility. Chat widget placed via widget injection on `/backend/inbox-ops/proposals/[id]` using Vercel AI SDK `useChat` hook.

## Technical Approach (Piotr)

**Self-contained module chat pattern.** The inbox_ops module implements its own chat API route (`POST /api/inbox-ops/agent/chat`) using Vercel AI SDK `streamText` directly. No dependency on ai-assistant subagent infrastructure (which does not yet exist). The chat widget is built within inbox_ops and calls the local route. This keeps the spec implementable without building generic subagent support.

Key constraints from Piotr:
1. System prompt loaded fresh from `agent_prompt` KB page at session start — never cached
2. Tools defined as Vercel AI SDK tools directly (not via MCP registry) — the 7 tools are scoped to this chat endpoint only
3. KB write tools emit lifecycle events for cache invalidation (reuse events from Spec 2)
4. No new entities — reuses `InboxKnowledgePage` from Spec 2 and existing proposal/email entities
5. The tools are also exported via the existing `aiTools: AiToolDefinition[]` pattern for MCP compatibility — both consumption paths use the same underlying implementation

### Triple-Exposure Pattern (CTO Directive)

Per Piotr's architecture vision, every module subagent is exposed three ways:

1. **MCP tool** — via existing `aiTools: AiToolDefinition[]` export in `ai-tools.ts` (already implemented for inbox_ops). Tools are auto-discovered by the ai-assistant module and registered in the global MCP server.

2. **Vercel AI SDK tools** — via `tool()` definitions used directly by the `streamText` call in the chat API route. These are the same tool implementations wrapped as AI SDK `tool()` objects.

3. **HTTP endpoint** — the `POST /api/inbox-ops/agent/chat` route itself, compliant with Vercel AI SDK server format. External applications can call this endpoint directly with the standard `{ messages }` format.

The tool logic is shared between all three paths. The `buildAgentTools()` function wraps the shared implementations as Vercel AI SDK tools for path #2. The `aiTools` export wraps them as MCP tool definitions for path #1. Path #3 is the API route itself.

This pattern enables:
- OpenCode integration (via MCP, path #1)
- In-app chat (via React component + HTTP endpoint, paths #2 + #3)
- External API access (via HTTP, path #3)
- Future: reusable chat component dropped onto any module page

**AI SDK v6 compliance:** This spec targets AI SDK v6 (`ai@^6.0.0`). Key patterns:
- `streamText` with `toUIMessageStreamResponse()` (not deprecated `toDataStreamResponse`)
- `tool()` helper for type-safe tool definitions
- `useChat` with `message.parts` for rendering (not deprecated `toolInvocations`)
- `stopWhen: stepCountIs(10)` for multi-step tool loops (not deprecated `maxSteps`)
- `generateText` + `Output.object()` for any structured output needs (not deprecated `generateObject`)

## Overview

The Wiki Agent is a contextual AI assistant embedded in the proposal review workflow. When a user reviews a proposal at `/backend/inbox-ops/proposals/[id]`, a collapsible chat panel lets them converse with an agent that has full read access to the proposal, its email thread, and the Knowledge Base — plus write access to KB pages.

The feedback loop: user spots a mistake in auto-approval or extraction, discusses it with the agent, agent updates KB rules/lessons, next email benefits from the updated knowledge. This closes the "self-improving system" loop described in the App Spec.

## Problem Statement

Currently, when a user reviews a proposal and discovers a mistake (wrong classification, missed contact match, incorrect auto-approval), correcting the system requires:
1. Leaving the proposal context
2. Navigating to Settings > Knowledge Base
3. Finding the right KB page (rules, lessons, contact types)
4. Editing raw markdown manually
5. Returning to the proposal to verify the fix

This context-switching friction means most corrections never happen. Users accept/reject proposals but never improve the underlying rules. The Knowledge Base stagnates.

The Wiki Agent eliminates this friction by letting users describe problems in natural language while looking at the proposal. The agent understands the proposal context, finds the relevant KB page, and makes the edit — all without the user leaving the review screen.

## Proposed Solution

### Design Decisions

**1. System prompt as a KB page (`agent_prompt` category)**

The agent's behavior instructions are stored as an `InboxKnowledgePage` with `category: 'agent_prompt'`. This means:
- Tenants can customize agent personality, tone, and capabilities by editing the page
- The prompt is versioned and auditable (same as other KB pages)
- No deployment needed to change agent behavior
- Fallback: if no `agent_prompt` page exists, a hardcoded default prompt is used

**2. Self-contained module chat**

The inbox_ops module owns its entire chat stack: API route, tool definitions, system prompt loading, and chat widget. This avoids a dependency on ai-assistant subagent infrastructure (which does not exist yet — the ai-assistant module provides a global tool registry and single-agent architecture, with no support for scoped tool sets or subagent discovery). When a generic subagent system is built in the future, this implementation can be migrated to use it.

**3. Vercel AI SDK integration**

The chat API route uses Vercel AI SDK `streamText` directly with the 7 tools defined as Vercel AI SDK tool objects. The same tool implementations are also exported via the existing `aiTools: AiToolDefinition[]` pattern for MCP compatibility (making them available in the global OpenCode agent). The tool logic is shared — only the consumption wrapper differs.

**4. Proposal context injection**

The chat component passes `proposalId` as context. Tools like `view_proposal` and `view_email` use this context to load the current proposal without requiring the user to specify which proposal they're discussing.

### Alternatives Considered

**Standalone chat page** — Rejected. The agent's value is contextual: it should know which proposal the user is looking at. A separate page would require the user to paste proposal IDs or describe what they're reviewing.

**Inline KB editing without agent** — Rejected. Inline editing solves the navigation problem but not the knowledge problem. Users don't always know which KB page to edit or what the correct rule syntax is. The agent can reason about the proposal, find the right page, and suggest the correct edit.

**n8n-based agent** — Rejected. Adds external dependency, complicates auth (n8n would need tenant-scoped API keys), and moves logic outside the module boundary. The agent should be a first-class module citizen, not an external workflow.

**Cached system prompt** — Rejected by Piotr. The prompt must reflect the latest KB state. A user might edit the `agent_prompt` page and immediately test the new behavior. Cache staleness would break this workflow. The prompt is a single KB page — loading it fresh is a single DB query, not a performance concern.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│              Proposal Detail Page                                 │
│  /backend/inbox-ops/proposals/[id]                                │
│                                                                   │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐  │
│  │   Email Thread        │  │   Summary + Actions              │  │
│  │   (existing)          │  │   (existing)                     │  │
│  └──────────────────────┘  └──────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │   Chat Panel (widget injection)                            │   │
│  │   spot: admin.page:inbox-ops/proposals/[id]:after          │   │
│  │                                                            │   │
│  │   ┌─ InboxAgentChat (self-contained component) ───────┐   │   │
│  │   │  POST /api/inbox-ops/agent/chat                   │   │   │
│  │   │  context: { proposalId }                          │   │   │
│  │   │                                                    │   │   │
│  │   │  User: "Why was this auto-approved?"               │   │   │
│  │   │  Agent: [calls view_proposal] ...                  │   │   │
│  │   │  Agent: [calls read_knowledge_page] ...            │   │   │
│  │   └────────────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│              inbox_ops Module — Agent Chat Route                   │
│                                                                   │
│  POST /api/inbox-ops/agent/chat { messages, proposalId }          │
│       │                                                           │
│       ├── Verify auth + requireFeatures('inbox_ops.proposals.view')│
│       ├── Load system prompt from agent_prompt KB page            │
│       ├── Vercel AI SDK streamText() with 7 scoped tools          │
│       ├── Stream response via SSE                                 │
│       │                                                           │
│       ▼                                                           │
│  Tool Execution (direct function calls, no MCP)                   │
│       │                                                           │
│       ├── view_proposal ──→ InboxProposal + Actions + Discrepancies
│       ├── view_email ────→ InboxEmail + ThreadMessages            │
│       ├── list_knowledge_pages ──→ InboxKnowledgePage[]           │
│       ├── read_knowledge_page ───→ InboxKnowledgePage             │
│       ├── update_knowledge_page ─→ InboxKnowledgePage + event     │
│       ├── create_knowledge_page ─→ InboxKnowledgePage + event     │
│       └── search_contacts ───────→ CustomerEntity[]               │
└──────────────────────────────────────────────────────────────────┘
```

## Tool Definitions

**SDK v6 pattern:** All tools use the `tool()` helper from `ai` package for type-safe definitions with Zod schema inference. The same tool logic is shared between the Vercel AI SDK consumption path (direct `tool()` objects) and the MCP export path (`aiTools: AiToolDefinition[]` in `ai-tools.ts`).

All 7 tools are defined in `packages/core/src/modules/inbox_ops/ai-tools.ts`, extending the existing `aiTools` array. Each tool follows the `AiToolDefinition` interface from `@open-mercato/ai-assistant`.

Example using the `tool()` helper:

```typescript
import { tool } from 'ai'
import { z } from 'zod'

// Example: inbox_ops_view_proposal
const viewProposalTool = tool({
  description: 'Read a proposal with all actions, discrepancies, and decision traces',
  inputSchema: z.object({
    proposalId: z.string().uuid().describe('The UUID of the proposal to inspect'),
  }),
  execute: async ({ proposalId }) => {
    // ... implementation
  },
})
```

### Tool 1: `inbox_ops_view_proposal`

Reads the current proposal's full detail including actions, discrepancies, and decision traces (from Spec 4).

```typescript
// Parameters
const viewProposalParams = z.object({
  proposalId: z.string().uuid()
    .describe('The UUID of the proposal to inspect'),
})

// Return type
type ViewProposalResult = {
  proposal: {
    id: string
    summary: string
    status: 'pending' | 'partial' | 'accepted' | 'rejected'
    category: string | null
    confidence: number
    possiblyIncomplete: boolean
    participants: Array<{
      name: string
      email: string
      role: string
      matchedContactId: string | null
    }>
  }
  actions: Array<{
    id: string
    actionType: string
    description: string
    status: string
    confidence: number
    autoApproved: boolean
    decisionTrace: Record<string, unknown> | null
    createdEntityId: string | null
    createdEntityType: string | null
    executionError: string | null
  }>
  discrepancies: Array<{
    id: string
    type: string
    severity: 'warning' | 'error'
    description: string
    expectedValue: string | null
    foundValue: string | null
    resolved: boolean
  }>
}
```

**Required feature:** `inbox_ops.proposals.view`

**Implementation notes:**
- Reuses existing query logic from `getProposalTool` but adds `autoApproved` and `decisionTrace` fields (from Spec 4 entity additions)
- Includes participant match data to support CRM-related conversations
- Returns all discrepancies (resolved and unresolved) so the agent can discuss resolution history

### Tool 2: `inbox_ops_view_email`

Reads the original email content and thread associated with a proposal.

```typescript
// Parameters
const viewEmailParams = z.object({
  proposalId: z.string().uuid()
    .describe('The UUID of the proposal whose email to retrieve'),
})

// Return type
type ViewEmailResult = {
  email: {
    id: string
    subject: string
    forwardedByAddress: string
    forwardedByName: string | null
    receivedAt: string
    detectedLanguage: string | null
    cleanedText: string | null
    threadMessages: Array<{
      from: { name?: string; email: string }
      to: Array<{ name?: string; email: string }>
      date: string
      body: string
      isForwarded: boolean
    }>
  }
} | { error: string }
```

**Required feature:** `inbox_ops.proposals.view`

**Implementation notes:**
- Loads `InboxProposal` first to get `inboxEmailId`, then loads the `InboxEmail`
- Returns `cleanedText` (plain text extraction) and `threadMessages` (parsed thread)
- Strips `rawHtml` and `rawText` from response — the agent doesn't need raw content, and it would waste context window tokens

### Tool 3: `inbox_ops_list_knowledge_pages`

Lists all Knowledge Base pages with title, category, active status, and sort order.

```typescript
// Parameters
const listKnowledgePagesParams = z.object({
  category: z.enum([
    'leads', 'scoring', 'pipelines', 'responses',
    'auto_approval', 'lessons', 'agent_prompt', 'general',
  ]).optional()
    .describe('Filter by category. Omit to list all pages.'),
  activeOnly: z.boolean().optional().default(true)
    .describe('If true (default), only return active pages'),
})

// Return type
type ListKnowledgePagesResult = {
  total: number
  pages: Array<{
    id: string
    title: string
    slug: string
    category: string
    sortOrder: number
    isActive: boolean
    updatedAt: string
    tokenEstimate: number
  }>
}
```

**Required feature:** `inbox_ops.settings.manage`

**Implementation notes:**
- Queries `InboxKnowledgePage` entity (from Spec 2) with tenant scoping
- Returns `tokenEstimate` (from entity field) so the agent can warn about token budget when suggesting edits
- Does NOT return page content — use `read_knowledge_page` for that (keeps list response lightweight)

### Tool 4: `inbox_ops_read_knowledge_page`

Reads a specific Knowledge Base page's full content.

```typescript
// Parameters
const readKnowledgePageParams = z.object({
  pageId: z.string().uuid().optional()
    .describe('The UUID of the page to read. Provide either pageId or slug.'),
  slug: z.string().optional()
    .describe('The slug of the page to read. Provide either pageId or slug.'),
}).refine(
  (data) => data.pageId || data.slug,
  { message: 'Either pageId or slug must be provided' },
)

// Return type
type ReadKnowledgePageResult = {
  page: {
    id: string
    title: string
    slug: string
    category: string
    content: string
    sortOrder: number
    isActive: boolean
    tokenEstimate: number
    updatedAt: string
  }
} | { error: string }
```

**Required feature:** `inbox_ops.settings.manage`

**Implementation notes:**
- Supports lookup by either `pageId` or `slug` — the agent may know the slug from context (e.g., "update the Lessons Learned page") but not the UUID
- Returns full `content` (markdown) for the agent to read and reason about before editing

### Tool 5: `inbox_ops_update_knowledge_page`

Edits an existing Knowledge Base page. Emits `inbox_ops.knowledge_page.updated` event.

```typescript
// Parameters
const updateKnowledgePageParams = z.object({
  pageId: z.string().uuid()
    .describe('The UUID of the page to update'),
  title: z.string().min(1).max(200).optional()
    .describe('New title for the page'),
  content: z.string().min(1).max(50000).optional()
    .describe('New markdown content for the page'),
  isActive: z.boolean().optional()
    .describe('Set active/inactive status'),
}).refine(
  (data) => data.title !== undefined || data.content !== undefined || data.isActive !== undefined,
  { message: 'At least one field (title, content, isActive) must be provided' },
)

// Return type
type UpdateKnowledgePageResult = {
  ok: true
  page: {
    id: string
    title: string
    slug: string
    category: string
    content: string
    tokenEstimate: number
    updatedAt: string
  }
} | { error: string }
```

**Required feature:** `inbox_ops.settings.manage`

**Implementation notes:**
- Recalculates `tokenEstimate` after content update using `Math.ceil(content.length / 4)` heuristic (from Spec 2)
- Emits `inbox_ops.knowledge_page.updated` event via `emitInboxOpsEvent` for cache invalidation
- Does NOT allow changing `category` or `slug` — those are structural and should be changed through the admin UI, not via agent conversation
- Validates token budget: if total active pages exceed the configured token budget after update, returns a warning in the response (but does not block the update — same behavior as the CRUD API from Spec 2)

### Tool 6: `inbox_ops_create_knowledge_page`

Creates a new Knowledge Base page. Emits `inbox_ops.knowledge_page.created` event.

```typescript
// Parameters
const createKnowledgePageParams = z.object({
  title: z.string().min(1).max(200)
    .describe('Title for the new page'),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .describe('URL-friendly slug (lowercase, hyphens). Must be unique per tenant.'),
  content: z.string().min(1).max(50000)
    .describe('Markdown content for the page'),
  category: z.enum([
    'leads', 'scoring', 'pipelines', 'responses',
    'auto_approval', 'lessons', 'agent_prompt', 'general',
  ]).describe('Page category'),
})

// Return type
type CreateKnowledgePageResult = {
  ok: true
  page: {
    id: string
    title: string
    slug: string
    category: string
    content: string
    tokenEstimate: number
    createdAt: string
  }
} | { error: string }
```

**Required feature:** `inbox_ops.settings.manage`

**Implementation notes:**
- Sets `sortOrder` to `max(sortOrder) + 10` within the category (auto-positioning)
- Sets `isActive: true` by default
- Computes `tokenEstimate` from content length
- Validates slug uniqueness per tenant — returns error if slug already exists
- Emits `inbox_ops.knowledge_page.created` event for cache invalidation
- Primary use case: agent creates a "Lessons Learned" entry or a new category-specific page based on conversation

### Tool 7: `inbox_ops_search_contacts`

Searches the CRM for existing contacts by name or email. Uses the existing `contactMatcher` infrastructure.

```typescript
// Parameters
const searchContactsParams = z.object({
  query: z.string().min(1).max(200)
    .describe('Search query — name, email, or company name'),
  kind: z.enum(['person', 'company']).optional()
    .describe('Filter by contact type. Omit to search both.'),
  limit: z.number().int().min(1).max(20).optional().default(10)
    .describe('Maximum results to return (default: 10)'),
})

// Return type
type SearchContactsResult = {
  total: number
  contacts: Array<{
    id: string
    kind: 'person' | 'company'
    displayName: string
    primaryEmail: string | null
    companyName: string | null
    createdAt: string
  }>
} | { error: string }
```

**Required feature:** `inbox_ops.proposals.view` (read-only CRM search, not full CRM access)

**Implementation notes:**
- Resolves `CustomerEntity` from DI container (same pattern as `resolveCrossModuleEntities` in existing tools)
- Performs case-insensitive `$like` search on `displayName` and `primaryEmail` fields
- Returns `companyName` if available (from entity or related company) to help the agent distinguish contacts
- Falls back gracefully if the customers module is not loaded: returns `{ error: 'CRM module not available' }`

## Agent Prompt & Chat Route

### System Prompt Loading

The agent's system prompt is loaded from the `InboxKnowledgePage` with `category: 'agent_prompt'` at chat session start. This is a fresh DB query every time — no caching.

```typescript
// lib/agentPrompt.ts

import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const DEFAULT_AGENT_PROMPT = `## Inbox Agent Instructions

You are the inbox-ops assistant for this business.
You help users review proposals, understand auto-approval decisions,
and improve the Knowledge Base.

### What you can do
- Explain why a proposal was created or auto-approved
- Show the Decision Trace for any auto-approved action
- Add lessons learned when something went wrong
- Update auto-approval rules, contact type definitions, scoring criteria
- Search CRM to verify contact matches
- Review the Decision Trace to explain why an action was auto-approved

### How to behave
- Be concise. The user is reviewing proposals, not reading essays.
- When updating the wiki, show what you changed before confirming.
- When adding lessons, be specific — include the exact scenario and rule.
- Never auto-approve on behalf of the user through the chat.
  Auto-approval is handled by the extraction pipeline, not by you.`

export async function loadAgentPrompt(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  deps: { knowledgePageEntity: EntityClass<InboxKnowledgePageLike> },
): Promise<string> {
  const page = await findOneWithDecryption(
    em,
    deps.knowledgePageEntity,
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      category: 'agent_prompt',
      isActive: true,
      deletedAt: null,
    },
    { orderBy: { sortOrder: 'ASC' } },
    scope,
  )

  return page?.content ?? DEFAULT_AGENT_PROMPT
}
```

### Chat API Route

The inbox_ops module implements its own chat endpoint using Vercel AI SDK `streamText`. No dependency on ai-assistant subagent infrastructure.

```typescript
// api/post/inbox-ops/agent/chat.ts

import { streamText, stopWhen, stepCountIs } from 'ai'
import { loadAgentPrompt } from '../../lib/agentPrompt'
import { buildAgentTools } from '../../lib/agentTools'
import { resolveExtractionProviderId, resolveOpenCodeProviderApiKey, resolveOpenCodeModel, createStructuredModel } from '../../lib/llmProvider'

export const openApi = { ... }

export default async function handler(req, res, { em, scope, container }) {
  requireFeatures(scope, ['inbox_ops.proposals.view'])

  const { messages, proposalId } = req.body

  // Load system prompt fresh from KB (never cached)
  const systemPrompt = await loadAgentPrompt(em, scope)

  // Build scoped tool set for this chat
  const tools = buildAgentTools({ em, scope, container, proposalId })

  // Check KB write permission for gating write tools
  const canWriteKB = hasFeature(scope, 'inbox_ops.settings.manage')

  // Rate limit: 20 requests per minute per user
  const rateLimiter = resolveRateLimiter(container)
  const rateLimitKey = `inbox_ops:agent:chat:${scope.userId}`
  const allowed = await rateLimiter.tryAcquire(rateLimitKey, { maxRequests: 20, windowMs: 60_000 })
  if (!allowed) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again in a moment.' })
  }

  const providerId = resolveExtractionProviderId()
  const apiKey = resolveOpenCodeProviderApiKey(providerId)
  const modelConfig = resolveOpenCodeModel(providerId, {
    overrideModel: process.env.INBOX_OPS_AGENT_MODEL || null,
  })
  const model = await createStructuredModel(providerId, apiKey, modelConfig.modelId)

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    tools: canWriteKB ? tools : omitWriteTools(tools),
    stopWhen: stepCountIs(10),  // Allow up to 10 tool call steps per message
    onStepFinish({ stepNumber, toolCalls, usage }) {
      // Optional: log step for debugging
    },
  })

  return result.toUIMessageStreamResponse()
}
```

The `buildAgentTools` function wraps the 7 tool implementations as Vercel AI SDK tool objects with Zod schemas. The same underlying logic is shared with the MCP-compatible `aiTools` export.
```

**Environment Variables:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `INBOX_OPS_AGENT_MODEL` | (uses extraction model) | Optional model override for the wiki agent chat |

### Session Management

Chat sessions are scoped to a proposal. The `proposalId` is passed from the `useChat` hook's `body` option with every request. Conversation history is maintained client-side by `useChat` (Vercel AI SDK). This means:
- The agent can call `view_proposal` without the user specifying which proposal
- Each widget instance has its own conversation state
- Navigating to a different proposal resets the chat (new component mount = new `useChat` instance)

## Chat Component Integration

### Widget Injection

The chat panel is injected into the proposal detail page via the standard widget injection pattern.

```typescript
// widgets/injection/InboxAgentChat.meta.ts
export const metadata = {
  id: 'inbox_ops.injection.agent-chat',
  name: 'Inbox Agent Chat',
  nameKey: 'inbox_ops.widgets.agentChat.name',
  requiredFeatures: ['inbox_ops.proposals.view'],
}
```

```typescript
// widgets/injection/InboxAgentChat.tsx
'use client'

import * as React from 'react'
import { useChat } from 'ai/react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

interface InboxAgentChatProps {
  context: {
    proposalId?: string
    subagentEndpoint?: string  // Default: '/api/inbox-ops/agent/chat'
    [key: string]: unknown
  }
}

export default function InboxAgentChat({ context }: InboxAgentChatProps) {
  const t = useT()
  const [isExpanded, setIsExpanded] = React.useState(false)

  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    api: context?.subagentEndpoint ?? '/api/inbox-ops/agent/chat',
    body: { proposalId: context?.proposalId },
    onError: (err) => {
      console.error('Agent chat error:', err)
    },
  })

  if (!context?.proposalId) return null

  return (
    <div className="border rounded-lg mt-4">
      <button
        type="button"
        className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-left hover:bg-accent/50 rounded-lg"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span>{t('inbox_ops.agent.chat_title', 'Inbox Assistant')}</span>
        <span className="text-xs text-muted-foreground">
          {isExpanded
            ? t('inbox_ops.agent.collapse', 'Collapse')
            : t('inbox_ops.agent.expand', 'Ask about this proposal')}
        </span>
      </button>
      {isExpanded && (
        <div className="border-t px-4 py-3">
          <div className="space-y-3 max-h-96 overflow-y-auto mb-3">
            {messages.map((m) => (
              <div key={m.id} className={`text-sm ${m.role === 'user' ? 'text-right' : ''}`}>
                {m.parts.map((part, i) => {
                  if (part.type === 'text' && part.text) {
                    return (
                      <span key={i} className={`inline-block px-3 py-2 rounded-lg ${
                        m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}>
                        {part.text}
                      </span>
                    )
                  }
                  // Tool call parts: show a compact status indicator
                  if (part.type.startsWith('tool-')) {
                    if (part.state === 'output-available') return null  // hide completed tool calls
                    return (
                      <span key={i} className="inline-block px-3 py-2 rounded-lg bg-muted text-muted-foreground italic text-xs">
                        {t('inbox_ops.agent.thinking', 'Looking up information...')}
                      </span>
                    )
                  }
                  return null
                })}
              </div>
            ))}
          </div>
          {error && (
            <div className="text-xs text-destructive px-3 py-2 bg-destructive/10 rounded-md">
              {error.message === 'Rate limit exceeded. Try again in a moment.'
                ? t('inbox_ops.agent.rate_limited', 'Too many messages. Please wait a moment.')
                : t('inbox_ops.agent.error', 'Something went wrong. Please try again.')}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              value={input}
              onChange={handleInputChange}
              placeholder={t('inbox_ops.agent.placeholder', 'Ask about this proposal...')}
              className="flex-1 px-3 py-2 border rounded-md text-sm"
              disabled={isLoading}
            />
            <button type="submit" disabled={isLoading} className="px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm">
              {t('inbox_ops.agent.send', 'Send')}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
```

### Injection Table

```typescript
// widgets/injection-table.ts
import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'admin.page:inbox-ops/proposals/[id]:after': {
    widgetId: 'inbox_ops.injection.agent-chat',
    priority: 10,
  },
}

export default injectionTable
```

**Reusability path:** The `InboxAgentChat` component is specific to inbox-ops proposals in this spec. However, the underlying chat pattern (widget injection + `useChat` + scoped tools) is designed to be extracted into a generic `@open-mercato/ui` `ModuleChat` component in a future spec. The inbox-ops implementation serves as the reference implementation.

### Context Passing

The proposal detail page passes context to injected widgets via the standard injection context mechanism. The chat widget receives `{ proposalId }` and includes it in every `POST /api/inbox-ops/agent/chat` request via the `body` option of `useChat`.

The chat route extracts `proposalId` from the request body and passes it to the tool execution context, making it available to `view_proposal` and `view_email` without requiring the user to specify it.

### UI Placement

The chat panel renders below the existing two-column layout (email thread + summary/actions). It starts collapsed to avoid overwhelming the review UI. When expanded, it takes the full width of the page body.

Placement rationale:
- Below content (not sidebar): the proposal detail page already uses a two-column layout. A third column would be too cramped on standard screens.
- Collapsible: most proposal reviews don't need the agent. The panel should not compete for attention with the primary review flow.
- Full width when expanded: gives the chat enough space for multi-line responses without horizontal scrolling.

## Data Models

No new entities. This spec reuses:

| Entity | From | Used By |
|--------|------|---------|
| `InboxKnowledgePage` | Spec 2 | `list_knowledge_pages`, `read_knowledge_page`, `update_knowledge_page`, `create_knowledge_page`, system prompt loading |
| `InboxProposal` | Existing | `view_proposal` |
| `InboxProposalAction` | Existing (extended by Spec 4 with `autoApproved`, `decisionTrace`) | `view_proposal` |
| `InboxDiscrepancy` | Existing | `view_proposal` |
| `InboxEmail` | Existing | `view_email` |
| `CustomerEntity` | `customers` module (resolved via DI) | `search_contacts` |

### Tool Parameter Schemas Summary

| Tool | Input Schema | Key Fields |
|------|-------------|------------|
| `inbox_ops_view_proposal` | `{ proposalId: uuid }` | Loads full proposal graph |
| `inbox_ops_view_email` | `{ proposalId: uuid }` | Loads email via proposal's `inboxEmailId` |
| `inbox_ops_list_knowledge_pages` | `{ category?: enum, activeOnly?: boolean }` | Filterable list |
| `inbox_ops_read_knowledge_page` | `{ pageId?: uuid, slug?: string }` | Lookup by ID or slug |
| `inbox_ops_update_knowledge_page` | `{ pageId: uuid, title?: string, content?: string, isActive?: boolean }` | Partial update + event |
| `inbox_ops_create_knowledge_page` | `{ title, slug, content, category }` | Full create + event |
| `inbox_ops_search_contacts` | `{ query: string, kind?: enum, limit?: number }` | CRM search |

## Seed Data

The `setup.ts` `seedDefaults` hook creates a default `agent_prompt` KB page if one does not already exist:

```typescript
// setup.ts (addition to seedDefaults)

async seedDefaults({ em, tenantId, organizationId, container }) {
  const InboxKnowledgePage = resolveKnowledgePageEntity(container)

  const existing = await findOneWithDecryption(
    em,
    InboxKnowledgePage,
    {
      tenantId,
      organizationId,
      category: 'agent_prompt',
      deletedAt: null,
    },
    undefined,
    { tenantId, organizationId },
  )

  if (!existing) {
    em.persist(em.create(InboxKnowledgePage, {
      tenantId,
      organizationId,
      title: 'Inbox Agent Instructions',
      slug: 'agent-prompt',
      category: 'agent_prompt',
      content: DEFAULT_AGENT_PROMPT,
      sortOrder: 0,
      isActive: true,
      tokenEstimate: Math.ceil(DEFAULT_AGENT_PROMPT.length / 4),
    }))
  }
},
```

This runs after Spec 2's seed defaults (which create the 4 starter KB pages). The `agent_prompt` seed is idempotent — safe to run on existing tenants.

## ACL

No new features added. The tools use existing features:

| Tool | Required Feature | Rationale |
|------|-----------------|-----------|
| `view_proposal` | `inbox_ops.proposals.view` | Read-only proposal access |
| `view_email` | `inbox_ops.proposals.view` | Email is part of proposal context |
| `list_knowledge_pages` | `inbox_ops.settings.manage` | KB management scope |
| `read_knowledge_page` | `inbox_ops.settings.manage` | KB content is configuration data |
| `update_knowledge_page` | `inbox_ops.settings.manage` | KB write requires settings permission |
| `create_knowledge_page` | `inbox_ops.settings.manage` | KB write requires settings permission |
| `search_contacts` | `inbox_ops.proposals.view` | Read-only CRM search, limited scope |

Users with `inbox_ops.proposals.view` can use the chat (read tools only). Users also need `inbox_ops.settings.manage` to use KB write tools. The tool registry enforces this via `requiredFeatures` — the agent will receive "Insufficient permissions" when a tool call is blocked.

## Backward Compatibility

This spec is **additive only**. No existing behavior is modified.

| Surface | Change | Impact |
|---------|--------|--------|
| `ai-tools.ts` exports | 7 new tools added to `aiTools` array | Additive — existing tools unchanged |
| API routes | New `POST /api/inbox-ops/agent/chat` | Additive — new route, no existing routes modified |
| Widget injection | New `injection-table.ts` and widget | Additive — new spot mapping |
| `setup.ts` | `seedDefaults` extended | Additive — new seed, existing seeds unchanged |
| Events | Uses existing `inbox_ops.knowledge_page.created/updated` events from Spec 2 | No new events — reuses Spec 2 declarations |
| ACL | No new features | Reuses existing `inbox_ops.proposals.view` and `inbox_ops.settings.manage` |
| i18n | New keys under `inbox_ops.agent.*` namespace: `chat_title`, `collapse`, `expand`, `placeholder`, `send`, `thinking`, `rate_limited`, `error` | Additive |

**No breaking changes. No migration needed.**

## Commit Plan

| # | Scope | Description | Files |
|---|-------|-------------|-------|
| 1 | Tools: proposal inspection | Implement `inbox_ops_view_proposal` and `inbox_ops_view_email` tools in `ai-tools.ts` | `ai-tools.ts` |
| 2 | Tools: KB read | Implement `inbox_ops_list_knowledge_pages` and `inbox_ops_read_knowledge_page` tools | `ai-tools.ts` |
| 3 | Tools: KB write | Implement `inbox_ops_update_knowledge_page` and `inbox_ops_create_knowledge_page` tools with KB event emission | `ai-tools.ts`, `lib/agentPrompt.ts` |
| 4 | Tools: CRM search | Implement `inbox_ops_search_contacts` tool | `ai-tools.ts` |
| 5 | Chat API route + agent prompt | Add `POST /api/inbox-ops/agent/chat` route using Vercel AI SDK `streamText`, `loadAgentPrompt` helper, `buildAgentTools` helper, system prompt loading from `agent_prompt` KB page with hardcoded fallback | `api/post/inbox-ops/agent/chat.ts`, `lib/agentPrompt.ts`, `lib/agentTools.ts` |
| 6 | Chat widget | Add `InboxAgentChat` injection widget with `useChat` hook, `injection-table.ts`, wire to proposal detail page | `widgets/injection/InboxAgentChat.tsx`, `widgets/injection/InboxAgentChat.meta.ts`, `widgets/injection-table.ts` |
| 7 | Seed + i18n + tests | Seed `agent_prompt` page in `setup.ts`, add i18n keys, add unit tests for tools and prompt loading | `setup.ts`, `i18n/*.json`, `__tests__/ai-tools.test.ts` |

## Integration Test Coverage

### TC-WIKI-001: Chat with proposal context

**Precondition:** Proposal exists with actions and discrepancies.

1. Navigate to `/backend/inbox-ops/proposals/{id}`
2. Expand the chat panel
3. Verify chat component renders with correct placeholder text
4. Verify `proposalId` is passed as context to the chat API

### TC-WIKI-002: KB update via agent tool

**Precondition:** Knowledge Base has a "Lessons Learned" page.

1. Call `inbox_ops_update_knowledge_page` tool with updated content
2. Verify the page content is updated in the database
3. Verify `inbox_ops.knowledge_page.updated` event is emitted
4. Verify `tokenEstimate` is recalculated
5. Read the page via `inbox_ops_read_knowledge_page` and verify updated content

### TC-WIKI-003: KB create via agent tool

1. Call `inbox_ops_create_knowledge_page` tool with new page data
2. Verify page is created with correct tenant scoping
3. Verify `inbox_ops.knowledge_page.created` event is emitted
4. Verify slug uniqueness — attempt duplicate slug returns error

### TC-WIKI-004: Search contacts tool

**Precondition:** CRM has contacts with known names/emails.

1. Call `inbox_ops_search_contacts` with a name query
2. Verify results include matching contacts with correct fields
3. Call with `kind: 'person'` filter — verify only people returned
4. Call with nonexistent query — verify empty results (not error)

### TC-WIKI-005: Agent uses Decision Trace

**Precondition:** Proposal has an auto-approved action with decision trace (Spec 4).

1. Call `inbox_ops_view_proposal` tool
2. Verify response includes `autoApproved: true` and `decisionTrace` on the auto-approved action
3. Verify the agent can reference the trace content in its response

### TC-WIKI-006: System prompt from KB page

1. Create an `agent_prompt` KB page with custom content
2. Start a new chat session — verify the custom prompt is loaded
3. Delete the `agent_prompt` page
4. Start a new chat session — verify the hardcoded fallback prompt is used

### TC-WIKI-007: Permission enforcement

1. Log in as user with `inbox_ops.proposals.view` but without `inbox_ops.settings.manage`
2. Call `inbox_ops_view_proposal` — verify success
3. Call `inbox_ops_update_knowledge_page` — verify permission denied
4. Call `inbox_ops_create_knowledge_page` — verify permission denied

### TC-WIKI-008: Agent prompt seed page

1. Run `seedDefaults` on a new tenant
2. Verify `agent_prompt` KB page exists with default content
3. Run `seedDefaults` again — verify no duplicate created (idempotent)

## Risks & Impact Review

### LLM Response Quality

**Risk:** The agent may produce unhelpful or incorrect responses when discussing proposals.

**Mitigation:** The system prompt (KB page) includes explicit behavioral guidelines. Tenants can refine the prompt based on their experience. The 7 tools are read-heavy (5 read, 2 write) — the agent has enough context to give informed answers.

### KB Modification via Agent

**Risk:** The agent could make destructive edits to Knowledge Base pages (overwriting important rules).

**Mitigations:**
1. `update_knowledge_page` does not allow changing `category` or `slug` — structural changes require the admin UI
2. The agent prompt instructs: "When updating the wiki, show what you changed before confirming"
3. KB write tools require `inbox_ops.settings.manage` — only admins can use them
4. All KB changes are auditable via `updatedAt` timestamps and the `inbox_ops.knowledge_page.updated` event
5. Future: version history on KB pages (not in scope for this spec)

### Prompt Injection via KB Content

**Risk:** A malicious user could edit the `agent_prompt` KB page to inject instructions that cause the agent to bypass guardrails.

**Mitigations:**
1. KB pages are tenant-scoped — only users within the same tenant can edit them
2. Editing requires `inbox_ops.settings.manage` (admin-level permission)
3. The agent's tool set is fixed (7 tools) — no prompt injection can grant additional capabilities
4. The AI assistant module enforces tool-level RBAC independently of the system prompt

### Token Budget

**Risk:** Very long KB pages could exceed the LLM's context window when loaded as system prompt.

**Mitigation:** The `agent_prompt` system prompt is a single KB page (not all pages concatenated). The `tokenEstimate` field and budget validation from Spec 2 apply. Typical agent prompts are 200-500 tokens — well within limits.

### Customers Module Not Loaded

**Risk:** `search_contacts` tool fails if the customers module is disabled.

**Mitigation:** The tool uses the same `resolveCrossModuleEntities` pattern as existing tools. If `CustomerEntity` is not available in the DI container, the tool returns `{ error: 'CRM module not available' }` instead of throwing.

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-14 | Spec Author | Initial spec — 7 tools, subagent config, chat widget, seed page |
| 2026-04-14 | Review | Replaced subagent infrastructure dependency with self-contained Vercel AI SDK pattern. `subagentConfig` → local `POST /api/inbox-ops/agent/chat` route. `useRegisteredComponent('ai-assistant:chat-panel')` → `useChat` from `ai/react`. Removed dependency on non-existent ai-assistant subagent discovery, scoped tool sets, and chat panel component. |
| 2026-04-14 | Review | Fix 1: Replaced hardcoded `anthropic('claude-sonnet-4-20250514')` with configurable model resolution via `resolveExtractionProviderId`/`createStructuredModel` + `INBOX_OPS_AGENT_MODEL` env var. Fix 2: Added rate limiting (20 req/min per user) on chat endpoint. Fix 3: Handle tool invocation messages in chat UI — show "thinking" indicator instead of blank messages. Fix 4: Replaced "Undo auto-approved actions" with "Review the Decision Trace" in default agent prompt (no undo tool exists). Fix 5: Added error handling and error display to chat component (`useChat` `onError`, rate limit and generic error messages). Fix 6: Verified `tokenEstimate` field name consistency (all correct, no `tokenCount` found). Added explicit i18n key list to backward compatibility table. |
| 2026-04-14 | SDK v6 + CTO | AI SDK v6 alignment and Piotr's architectural vision: (1) `toDataStreamResponse()` → `toUIMessageStreamResponse()`, (2) Added `stopWhen: stepCountIs(10)` for multi-step tool loops with `onStepFinish` callback, (3) Added `tool()` helper pattern with example and SDK v6 note in Tool Definitions section, (4) Replaced `m.content`/`m.toolInvocations` message rendering with `message.parts` API, (5) Documented Triple-Exposure Pattern (MCP + AI SDK tools + HTTP endpoint) per CTO directive, (6) Added AI SDK v6 compliance summary (deprecated patterns and their replacements), (7) Updated chat component props with `subagentEndpoint` for reusability and added `ModuleChat` extraction note. |
