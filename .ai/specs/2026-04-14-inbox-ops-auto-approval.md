# Inbox-Ops Auto-Approval Engine

| Field | Value |
|-------|-------|
| **Status** | Approved |
| **Created** | 2026-04-14 |
| **App Spec** | `apps/mercato/app-spec/inbox-ops-lead-intake.md` |
| **Related Specs** | `2026-04-14-inbox-ops-knowledge-base.md` (Spec 2 — provides KB pages), `2026-04-14-inbox-ops-crm-actions.md` (Spec 1 — action types) |
| **Depends On** | Spec 2 (Knowledge Base entity must exist for `auto_approval` + `lessons` pages) |
| **Blocked By** | — |

## TLDR

Add a second LLM evaluation pass to the extraction pipeline that decides, per action, whether to auto-approve based on wiki-governed rules. Auto-approved actions execute immediately via the existing `executeAction` codepath with `executedBy: 'system'`. Each decision is recorded as a structured `decisionTrace` on the action for full auditability. No `auto_approval` KB pages means all actions default to manual review (opt-in autonomy). LLM failure to produce a valid Decision Trace also falls back to manual review.

## Technical Approach (Piotr)

1. **Mode:** Core module extension (inbox_ops) — no new module, no new entities.
2. **Two-phase extraction:** After extracting actions, a SECOND structured LLM call (`generateText` with `Output.object()`) evaluates auto-approval per action. Separation of concerns — extraction and approval are independent judgments with independent prompts.
3. **Entity changes:** `InboxProposalAction` gets 2 new fields: `autoApproved: boolean` (default false) and `decisionTrace: jsonb` (nullable).
4. **Auto-approved actions:** Executed immediately in `extractionWorker` — same `executeAction` codepath, but `executedBy: 'system'` (no userId, uses `SYSTEM_USER_ID`).
5. **No `auto_approval` KB pages → all actions default to manual review** (opt-in autonomy).
6. **LLM failure to produce Decision Trace → fall back to manual review** (no auto-approval without trace).
7. **Notification for auto-approved actions:** Uses existing notification infrastructure, includes undo link via existing undo token mechanism.

## Overview

The Auto-Approval Engine transforms inbox-ops from a "human in the loop" system to a "human on the loop" system. Instead of every action requiring manual review before execution, the agent can autonomously execute actions when the tenant's Knowledge Base says it is safe to do so. Humans monitor auto-approved actions via notifications and can undo mistakes.

The engine is fully wiki-governed — no hardcoded thresholds in code. A tenant that wants aggressive autonomy (auto-approve everything above 70% confidence) edits their Knowledge Base. A tenant that wants full control writes "Never auto-approve any action." The Knowledge Base is the single source of judgment.

## Problem Statement

Every extracted action currently requires explicit human approval before execution. For high-confidence, low-risk actions (logging an activity, creating a contact from a clear email), this creates a bottleneck:

- **Latency:** CRM records are only created after a human reviews the proposal, which could be hours or days.
- **Friction:** Operators must review dozens of routine proposals daily, most of which are straightforward.
- **Scaling ceiling:** As email volume grows, the review queue becomes unmanageable.

The system needs a way to autonomously execute actions that meet tenant-defined criteria while maintaining full transparency and undo capability.

## Proposed Solution

### Design Decisions

**Two-phase extraction (not single LLM call):**
The extraction prompt focuses on *what* to do — parsing email content into structured actions. The auto-approval prompt focuses on *whether* to do it — evaluating each action against rules and lessons. Combining these into a single call would (a) make the extraction prompt more complex and less focused, (b) conflate two different judgment tasks, and (c) make it harder to disable auto-approval without affecting extraction quality. The second call is skipped entirely when no `auto_approval` pages exist.

**Wiki-governed, not code-governed:**
Hardcoded rules (e.g., "auto-approve when confidence > 0.9") cannot account for tenant-specific business context. A logistics company might want aggressive auto-approval; a legal firm might want none. The Knowledge Base lets each tenant define their own autonomy boundaries in natural language. The LLM interprets these rules contextually — it understands "conference attendee list" exceptions without regex patterns.

**Opt-in autonomy (no KB pages = manual review):**
A tenant that has not written any `auto_approval` pages gets the current behavior — everything requires manual review. This prevents accidental autonomous execution in new tenants or tenants that have not configured the feature.

**Fail-safe to manual review:**
If the auto-approval LLM call fails, times out, or produces an invalid structured output, all actions fall back to manual review. The system never auto-approves without a valid Decision Trace.

### Alternatives Considered

**Single LLM call with auto-approval baked into extraction:**
Rejected. The extraction prompt is already complex (action schemas, contact matching, catalog products). Adding auto-approval rules and lessons into the same system prompt would reduce extraction quality. Two focused calls produce better results than one overloaded call.

**Code-based rules engine (if confidence > X and type == Y then approve):**
Rejected. Cannot express tenant-specific business context like "don't auto-approve contacts from conference emails" or "freelancers should not get deals." The wiki approach handles arbitrary business logic without code changes.

**Confidence threshold only:**
Rejected. Confidence alone is insufficient. A 95% confidence `create_contact` with a discrepancy should not be auto-approved. A 85% confidence `log_activity` is always safe. The action type, discrepancies, and business context all matter — the wiki captures these nuances.

## Architecture

### Pipeline Flow

```
Email arrives at webhook
  │
  ▼
extractionWorker subscribes to inbox_ops.email.received
  │
  ├─ Phase 1: Extraction (existing)
  │   buildExtractionSystemPrompt() + runExtractionWithConfiguredProvider()
  │   → ExtractionOutput (actions, discrepancies, participants)
  │
  ├─ Persist proposal + actions + discrepancies (existing)
  │
  ├─ Phase 2: Auto-Approval Evaluation (NEW)
  │   ├─ Load auto_approval + lessons KB pages
  │   ├─ If no auto_approval pages → skip (all actions stay pending)
  │   ├─ buildAutoApprovalPrompt(actions, kbPages)
  │   ├─ runAutoApprovalWithConfiguredProvider()
  │   │   → AutoApprovalOutput (per-action decisions + traces)
  │   ├─ If LLM call fails → skip (all actions stay pending, log warning)
  │   └─ Apply decisions: mark autoApproved + store decisionTrace
  │
  ├─ Phase 3: Execute Auto-Approved Actions (NEW)
  │   ├─ For each action where autoApproved === true:
  │   │   ├─ executeAction(action, { ...ctx, userId: SYSTEM_USER_ID })
  │   │   ├─ On success: action.status = 'executed'
  │   │   └─ On failure: action.status = 'failed', clear autoApproved
  │   └─ recalculateProposalStatus()
  │
  ├─ Emit events (existing + enhanced)
  │   ├─ inbox_ops.proposal.created (existing, enhanced with autoApprovalSummary)
  │   └─ inbox_ops.action.auto_approved (NEW — one event per proposal)
  │
  └─ Notification subscriber
      ├─ inbox_ops.proposal.created → existing notification
      └─ inbox_ops.action.auto_approved → new notification with undo links
```

### Sequence: Auto-Approval Within extractionWorker

```
extractionWorker.handle()
  ├─ [Steps 1-8: existing extraction, persist, update email status]
  │
  ├─ Step 8.5: Auto-Approval Evaluation
  │   ├─ loadKnowledgePages(tenantId, organizationId, ['auto_approval'])
  │   ├─ if (autoApprovalPages.length === 0) → skip to Step 9
  │   ├─ loadKnowledgePages(tenantId, organizationId, ['lessons'])
  │   ├─ buildAutoApprovalPrompt(allActions, autoApprovalPages, lessonsPages)
  │   ├─ try:
  │   │   ├─ runAutoApprovalWithConfiguredProvider(prompt)
  │   │   ├─ Parse + validate AutoApprovalOutput
  │   │   ├─ For each action decision:
  │   │   │   ├─ action.autoApproved = decision.autoApproved
  │   │   │   └─ action.decisionTrace = decision.trace
  │   │   └─ em.flush()
  │   └─ catch:
  │       └─ Log warning, continue (all actions stay pending)
  │
  ├─ Step 8.6: Execute Auto-Approved Actions
  │   ├─ autoApprovedActions = allActions.filter(a => a.autoApproved)
  │   ├─ For each action (in sortOrder):
  │   │   ├─ executeAction(action, systemCtx)
  │   │   ├─ if failed: action.autoApproved = false, log warning
  │   │   └─ collect execution results
  │   ├─ recalculateProposalStatus(em, proposalId, scope)
  │   └─ em.flush()
  │
  └─ Step 9: Emit events (existing, enhanced)
```

## Data Models

### Entity Changes: InboxProposalAction

Two new fields added to the existing `InboxProposalAction` entity:

```typescript
// packages/core/src/modules/inbox_ops/data/entities.ts

// Add to InboxProposalAction class:

@Property({ name: 'auto_approved', type: 'boolean', default: false })
autoApproved: boolean = false

@Property({ name: 'decision_trace', type: 'json', nullable: true })
decisionTrace?: DecisionTrace | null
```

Update `[OptionalProps]`:
```typescript
[OptionalProps]?: 'status' | 'autoApproved' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'
```

### DecisionTrace Type

```typescript
// packages/core/src/modules/inbox_ops/data/entities.ts

export interface DecisionTrace {
  autoApproved: boolean
  reasoning: string
  rulesApplied: string[]
  lessonsChecked: string[]
  confidence: number
  decidedAt: string
}
```

### Database Migration

New migration adds two columns to `inbox_proposal_actions`:

```sql
ALTER TABLE inbox_proposal_actions
  ADD COLUMN auto_approved boolean NOT NULL DEFAULT false;

ALTER TABLE inbox_proposal_actions
  ADD COLUMN decision_trace jsonb NULL;
```

No index needed on `auto_approved` — queries filter by `status` (already indexed), and `autoApproved` is used for display only.

### Auto-Approval Evaluation Schema (Zod)

```typescript
// packages/core/src/modules/inbox_ops/data/validators.ts

export const decisionTraceSchema = z.object({
  autoApproved: z.boolean(),
  reasoning: z.string(),
  rulesApplied: z.array(z.string()),
  lessonsChecked: z.array(z.string()),
  confidence: z.number(),
  decidedAt: z.string(),
})

export const autoApprovalActionDecisionSchema = z.object({
  actionIndex: z.number().describe('Zero-based index of the action in the proposal'),
  autoApproved: z.boolean(),
  reasoning: z.string().describe('Explanation of why this action was or was not auto-approved'),
  rulesApplied: z.array(z.string()).describe('Which auto-approval rules matched this action'),
  lessonsChecked: z.array(z.string()).describe('Which lessons were checked and their applicability'),
})

export const autoApprovalOutputSchema = z.object({
  decisions: z.array(autoApprovalActionDecisionSchema),
})

export type DecisionTrace = z.infer<typeof decisionTraceSchema>
export type AutoApprovalOutput = z.infer<typeof autoApprovalOutputSchema>
export type AutoApprovalActionDecision = z.infer<typeof autoApprovalActionDecisionSchema>
```

### ActionDetail Type Update

```typescript
// packages/core/src/modules/inbox_ops/components/proposals/types.ts

export type ActionDetail = {
  // ... existing fields ...
  autoApproved?: boolean
  decisionTrace?: DecisionTrace | null
}
```

### Event Payload

New event added to `events.ts`:

```typescript
{ id: 'inbox_ops.action.auto_approved', label: 'Actions Auto-Approved', entity: 'action', category: 'custom' }
```

Event payload:
```typescript
interface ActionAutoApprovedPayload {
  proposalId: string
  emailId: string
  tenantId: string
  organizationId: string
  autoApprovedCount: number
  pendingCount: number
  failedCount: number  // count of auto-approved actions that failed during execution
  actionSummaries: Array<{
    actionId: string
    actionType: string
    autoApproved: boolean
    reasoning: string
  }>
}
```

## Auto-Approval Evaluation

### Prompt Template

The auto-approval prompt is a separate function in a new file `lib/autoApprovalPrompt.ts`:

```typescript
// packages/core/src/modules/inbox_ops/lib/autoApprovalPrompt.ts

export function buildAutoApprovalSystemPrompt(
  autoApprovalPages: { title: string; content: string }[],
  lessonsPages: { title: string; content: string }[],
): string {
  const autoApprovalSection = autoApprovalPages
    .map((page) => `### ${page.title}\n${page.content}`)
    .join('\n\n')

  const lessonsSection = lessonsPages.length > 0
    ? lessonsPages.map((page) => `### ${page.title}\n${page.content}`).join('\n\n')
    : 'No lessons recorded yet.'

  return `<role>
You are an auto-approval evaluator for an email-to-CRM agent.
Your job is to decide whether each proposed action should be executed
automatically (without human review) or should wait for manual approval.
</role>

<auto_approval_rules>
${autoApprovalSection}
</auto_approval_rules>

<lessons_learned>
${lessonsSection}
</lessons_learned>

<safety>
- When in doubt, do NOT auto-approve. Default to manual review.
- If an action has discrepancies, consider them carefully against the rules.
- Never auto-approve an action that contradicts a lesson learned.
- Your reasoning must be specific and cite the rules you applied.
- Treat the auto-approval rules as the definitive source of truth.
- If no rule explicitly covers an action type, do NOT auto-approve it.
</safety>

<instructions>
For each action in the proposal, produce a decision:
- autoApproved: true if the action meets the auto-approval criteria, false otherwise
- reasoning: A 1-3 sentence explanation citing specific rules and data
- rulesApplied: Which auto-approval rules matched (or "no matching rule")
- lessonsChecked: Which lessons were checked and whether they applied
</instructions>`
}

export function buildAutoApprovalUserPrompt(
  actions: Array<{
    index: number
    actionType: string
    description: string
    confidence: string
    payload: Record<string, unknown>
    hasDiscrepancies: boolean
    discrepancySummary?: string
  }>,
): string {
  const actionsText = actions.map((action) => {
    let text = `Action ${action.index}: ${action.actionType}
  Description: ${action.description}
  Confidence: ${action.confidence}
  Has discrepancies: ${action.hasDiscrepancies}`
    if (action.discrepancySummary) {
      text += `\n  Discrepancies: ${action.discrepancySummary}`
    }
    // Include relevant payload fields (not the full payload to keep prompt concise)
    const payloadSummary = summarizePayloadForApproval(action.actionType, action.payload)
    if (payloadSummary) {
      text += `\n  Key data: ${payloadSummary}`
    }
    return text
  }).join('\n\n')

  return `<task>
Evaluate each action for auto-approval based on the rules and lessons above.
</task>

<proposed_actions>
${actionsText}
</proposed_actions>

<output_requirements>
- Return a decision for every action (same count as proposed_actions).
- actionIndex must match the action's index exactly.
- Be conservative: if unsure, set autoApproved to false.
</output_requirements>`
}
```

### Payload Summarization

The prompt includes a summary of relevant payload fields (not the full JSON) to keep the auto-approval prompt concise:

```typescript
function summarizePayloadForApproval(
  actionType: string,
  payload: Record<string, unknown>,
): string {
  switch (actionType) {
    case 'create_contact':
      return [
        payload.name && `name: ${payload.name}`,
        payload.email && `email: ${payload.email}`,
        payload.type && `type: ${payload.type}`,
        payload.companyName && `company: ${payload.companyName}`,
      ].filter(Boolean).join(', ')

    case 'create_order':
    case 'create_quote': {
      const lineItems = Array.isArray(payload.lineItems) ? payload.lineItems : []
      return [
        payload.customerName && `customer: ${payload.customerName}`,
        `${lineItems.length} line items`,
        payload.currencyCode && `currency: ${payload.currencyCode}`,
      ].filter(Boolean).join(', ')
    }

    case 'log_activity':
      return [
        payload.activityType && `type: ${payload.activityType}`,
        payload.contactName && `contact: ${payload.contactName}`,
        payload.subject && `subject: ${payload.subject}`,
      ].filter(Boolean).join(', ')

    case 'draft_reply':
      return [
        payload.to && `to: ${payload.to}`,
        payload.subject && `subject: ${payload.subject}`,
      ].filter(Boolean).join(', ')

    case 'link_contact':
      return [
        payload.contactName && `name: ${payload.contactName}`,
        payload.emailAddress && `email: ${payload.emailAddress}`,
      ].filter(Boolean).join(', ')

    case 'create_deal':
      return [
        payload.title && `title: ${payload.title}`,
        payload.source && `source: ${payload.source}`,
        payload.personId && `personId: ${payload.personId}`,
        payload.companyId && `companyId: ${payload.companyId}`,
      ].filter(Boolean).join(', ')

    case 'update_contact':
      return [
        payload.entityId && `entityId: ${payload.entityId}`,
        payload.entityType && `entityType: ${payload.entityType}`,
        payload.relationshipType && `relationshipType: ${payload.relationshipType}`,
      ].filter(Boolean).join(', ')

    case 'update_deal':
      return [
        payload.dealId && `dealId: ${payload.dealId}`,
        payload.stageId && `stageId: ${payload.stageId}`,
        payload.customFields && `customFields: ${Object.keys(payload.customFields as Record<string, unknown>).join(', ')}`,
      ].filter(Boolean).join(', ')

    default:
      return ''
  }
}
```

### LLM Call

The auto-approval evaluation uses the same `createStructuredModel` infrastructure as extraction but with its own schema:

```typescript
// packages/core/src/modules/inbox_ops/lib/llmProvider.ts

import { generateText, Output } from 'ai'

export async function runAutoApprovalWithConfiguredProvider(input: {
  systemPrompt: string
  userPrompt: string
  modelOverride?: string | null
  timeoutMs: number
}): Promise<{
  object: AutoApprovalOutput
  totalTokens: number
}> {
  const providerId = resolveExtractionProviderId()
  const apiKey = resolveOpenCodeProviderApiKey(providerId)
  if (!apiKey) {
    throw new Error(`Missing API key for provider "${providerId}"`)
  }

  const modelConfig = resolveOpenCodeModel(providerId, {
    overrideModel: input.modelOverride,
  })
  const model = await createStructuredModel(providerId, apiKey, modelConfig.modelId)

  const result = await withTimeout(
    generateText({
      model,
      output: Output.object({ schema: autoApprovalOutputSchema }),
      system: input.systemPrompt,
      prompt: input.userPrompt,
      temperature: 0,
    }),
    input.timeoutMs,
    `Auto-approval evaluation timed out after ${input.timeoutMs}ms`,
  )

  return {
    object: result.output,
    totalTokens: Number(result.usage?.totalTokens ?? 0) || 0,
  }
}
```

**SDK compatibility note:** This spec uses `generateText` with `Output.object()` (AI SDK v6 pattern). The deprecated `generateObject` function is NOT used. The existing extraction pipeline in `llmProvider.ts` still uses `generateObject` and should be migrated separately.

### KB Page Loading

Uses the `InboxKnowledgePage` entity from Spec 2. Pages are loaded by category:

```typescript
// packages/core/src/modules/inbox_ops/lib/autoApprovalEvaluator.ts

import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
// InboxKnowledgePage from Spec 2

async function loadKnowledgePagesByCategory(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  categories: string[],
): Promise<{ title: string; content: string; category: string }[]> {
  const InboxKnowledgePage = ... // resolved from Spec 2 entity
  const pages = await findWithDecryption(
    em,
    InboxKnowledgePage,
    {
      category: { $in: categories },
      isActive: true,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { orderBy: { sortOrder: 'ASC' } },
    scope,
  )
  return pages.map((p) => ({
    title: p.title,
    content: p.content,
    category: p.category,
  }))
}
```

### Decision Trace Example

```json
{
  "autoApproved": true,
  "reasoning": "Contact has email address (john@acme.com), confidence 92% exceeds 90% threshold per auto-approval rules. No discrepancies. No lessons-learned exclusions matched.",
  "rulesApplied": ["create_contact: confidence >= 90% AND email present"],
  "lessonsChecked": ["conference duplicate rule - not applicable"],
  "confidence": 0.92,
  "decidedAt": "2026-04-14T10:32:15Z"
}
```

```json
{
  "autoApproved": false,
  "reasoning": "draft_reply actions are never auto-approved per the 'Never auto-approve' section of the auto-approval rules.",
  "rulesApplied": ["draft_reply: never auto-approve"],
  "lessonsChecked": [],
  "confidence": 0.88,
  "decidedAt": "2026-04-14T10:32:15Z"
}
```

## Pipeline Integration

### Step-by-Step Integration into extractionWorker

The auto-approval logic is inserted between the existing Step 8 (flush proposal/actions/discrepancies) and Step 9 (emit events). This ensures all entities are persisted before auto-approval evaluation begins.

**New file: `lib/autoApprovalEvaluator.ts`**

```typescript
export async function evaluateAutoApproval(input: {
  em: EntityManager
  actions: InboxProposalAction[]
  discrepancies: InboxDiscrepancy[]
  scope: { tenantId: string; organizationId: string }
  modelOverride?: string | null
}): Promise<{
  evaluated: boolean
  autoApprovedCount: number
  tokensUsed: number
}> {
  const { em, actions, discrepancies, scope } = input

  // 1. Load auto_approval pages
  const autoApprovalPages = await loadKnowledgePagesByCategory(
    em, scope, ['auto_approval'],
  )

  // 2. No pages → skip (opt-in autonomy)
  if (autoApprovalPages.length === 0) {
    return { evaluated: false, autoApprovedCount: 0, tokensUsed: 0 }
  }

  // 3. Load lessons pages
  const lessonsPages = await loadKnowledgePagesByCategory(
    em, scope, ['lessons'],
  )

  // 4. Build prompts
  const systemPrompt = buildAutoApprovalSystemPrompt(autoApprovalPages, lessonsPages)
  const userPrompt = buildAutoApprovalUserPrompt(
    actions.map((action, index) => {
      const actionDiscrepancies = discrepancies.filter(
        (d) => d.actionId === action.id && !d.resolved,
      )
      return {
        index,
        actionType: action.actionType,
        description: action.description,
        confidence: action.confidence,
        payload: action.payload as Record<string, unknown>,
        hasDiscrepancies: actionDiscrepancies.length > 0,
        discrepancySummary: actionDiscrepancies.length > 0
          ? actionDiscrepancies.map((d) => `${d.type}: ${d.description}`).join('; ')
          : undefined,
      }
    }),
  )

  // 5. Call LLM
  const timeoutMs = parseInt(process.env.INBOX_OPS_AUTO_APPROVAL_TIMEOUT_MS || '30000', 10)
  const result = await runAutoApprovalWithConfiguredProvider({
    systemPrompt,
    userPrompt,
    modelOverride: input.modelOverride,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000,
  })

  // 6. Apply decisions
  const now = new Date().toISOString()
  let autoApprovedCount = 0

  for (const decision of result.object.decisions) {
    const action = actions[decision.actionIndex]
    if (!action) continue

    const trace: DecisionTrace = {
      autoApproved: decision.autoApproved,
      reasoning: decision.reasoning,
      rulesApplied: decision.rulesApplied,
      lessonsChecked: decision.lessonsChecked,
      // action.confidence is stored as string in the entity; DecisionTrace uses number for structured output
      confidence: parseFloat(action.confidence),
      decidedAt: now,
    }

    action.decisionTrace = trace
    action.autoApproved = decision.autoApproved

    if (decision.autoApproved) {
      autoApprovedCount++
    }
  }

  await em.flush()

  return { evaluated: true, autoApprovedCount, tokensUsed: result.totalTokens }
}
```

### Execution of Auto-Approved Actions

After evaluation, the extractionWorker executes auto-approved actions using the existing `executeAction` codepath:

```typescript
// In extractionWorker.ts, after evaluateAutoApproval:

async function executeAutoApprovedActions(
  em: EntityManager,
  actions: InboxProposalAction[],
  proposalId: string,
  scope: { tenantId: string; organizationId: string },
  ctx: ResolverContext,
): Promise<{ executedCount: number; failedCount: number }> {
  const autoApproved = actions
    .filter((a) => a.autoApproved && a.status === 'pending')
    .sort((a, b) => a.sortOrder - b.sortOrder)

  if (autoApproved.length === 0) {
    return { executedCount: 0, failedCount: 0 }
  }

  let executedCount = 0
  let failedCount = 0

  const executionCtx = buildSystemExecutionContext(em, scope, ctx)

  for (const action of autoApproved) {
    const result = await executeAction(action, executionCtx)

    if (result.success) {
      executedCount++
    } else {
      failedCount++
      action.autoApproved = false
      if (action.decisionTrace) {
        action.decisionTrace = {
          ...action.decisionTrace,
          autoApproved: false,
          reasoning: `${action.decisionTrace.reasoning} [Auto-execution failed: ${result.error}]`,
        }
      }
      // Do NOT flush here — collect all mutations and flush once after the loop
    }
  }

  // Single flush for all mutations
  await em.flush()

  // Recalculate using the same EM (sees all flushed changes)
  await recalculateProposalStatus(em, proposalId, scope)

  return { executedCount, failedCount }
}

function buildSystemExecutionContext(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  ctx: ResolverContext,
): ExecutionContext {
  return {
    em,
    userId: SYSTEM_USER_ID,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    eventBus: tryResolve(ctx, 'eventBus'),
    container: ctx as unknown as AwilixContainer,
    entities: resolveEntityClasses(ctx) as unknown as CrossModuleEntities,
  }
}
```

### Proposal Status with Auto-Approval

The existing `recalculateProposalStatus` function already handles the correct statuses. After auto-approval execution:

- **All actions auto-approved and executed** → proposal status `accepted`
- **Some auto-approved (executed), some pending** → proposal status `partial`
- **No auto-approved** → proposal status `pending` (normal flow)
- **Some auto-approved (executed), some rejected** → proposal status `partial`

No changes needed to `recalculateProposalStatus` — it already calculates status from action statuses.

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `INBOX_OPS_AUTO_APPROVAL_TIMEOUT_MS` | `30000` | Timeout for the auto-approval LLM call (ms) |
| `INBOX_OPS_AUTO_APPROVAL_MODEL` | (uses extraction model) | Optional model override for auto-approval evaluation |

### RBAC Bypass for System Execution

The `executeAction` function calls `ensureUserCanExecuteAction` which checks RBAC permissions. When `userId` is `SYSTEM_USER_ID`, the RBAC check must be bypassed since the system user represents autonomous agent execution, not a human user:

```typescript
// In executionEngine.ts, update ensureUserCanExecuteAction:

async function ensureUserCanExecuteAction(
  action: InboxProposalAction,
  ctx: ExecutionContext,
): Promise<void> {
  // SECURITY: SYSTEM_USER_ID bypass is intentional for wiki-governed auto-approval.
  // Auto-approved actions are audited via DecisionTrace and reversible via undo tokens.
  // If additional validation is added to this function (rate limits, entity locks, etc.),
  // consider whether it should apply to auto-approved actions as well.
  if (ctx.userId === SYSTEM_USER_ID) return

  // ... existing RBAC check logic
}
```

The `SYSTEM_USER_ID` constant (`00000000-0000-0000-0000-000000000000`) is already defined in `extractionWorker.ts`.

## Notification & Undo

### New Notification Type

```typescript
// packages/core/src/modules/inbox_ops/notifications.ts

{
  type: 'inbox_ops.action.auto_approved',
  module: 'inbox_ops',
  titleKey: 'inbox_ops.notifications.actions_auto_approved.title',
  bodyKey: 'inbox_ops.notifications.actions_auto_approved.body',
  icon: 'zap',
  severity: 'info',
  actions: [
    {
      id: 'review',
      labelKey: 'inbox_ops.action.review',
      variant: 'outline',
      href: '/backend/inbox-ops/proposals/{sourceEntityId}',
      icon: 'external-link',
    },
  ],
  linkHref: '/backend/inbox-ops/proposals/{sourceEntityId}',
  expiresAfterHours: 168,
}
```

### i18n Keys

```json
{
  "inbox_ops.notifications.actions_auto_approved.title": "Actions auto-approved",
  "inbox_ops.notifications.actions_auto_approved.body": "{autoApprovedCount} actions were auto-approved and executed",
  "inbox_ops.badge.auto_approved": "Auto-approved",
  "inbox_ops.decision_trace.title": "Why was this auto-approved?",
  "inbox_ops.decision_trace.reasoning": "Reasoning",
  "inbox_ops.decision_trace.rules_applied": "Rules applied",
  "inbox_ops.decision_trace.lessons_checked": "Lessons checked",
  "inbox_ops.decision_trace.decided_at": "Decided at"
}
```

### Notification Subscriber

New subscriber `subscribers/autoApprovalNotifier.ts`:

```typescript
export const metadata = {
  event: 'inbox_ops.action.auto_approved',
  persistent: true,
  id: 'inbox_ops:auto-approval-notifier',
}

export default async function handle(payload: ActionAutoApprovedPayload, ctx: ResolverContext) {
  const notificationService = resolveNotificationService(ctx)
  const typeDef = notificationTypes.find((t) => t.type === 'inbox_ops.action.auto_approved')
  if (!typeDef) return

  const notificationInput = buildFeatureNotificationFromType(typeDef, {
    requiredFeature: 'inbox_ops.proposals.view',
    bodyVariables: {
      autoApprovedCount: String(payload.autoApprovedCount),
    },
    sourceEntityType: 'inbox_ops:proposal',
    sourceEntityId: payload.proposalId,
    linkHref: `/backend/inbox-ops/proposals/${payload.proposalId}`,
  })

  await notificationService.createForFeature(notificationInput, {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId ?? null,
  })
}
```

### Undo Mechanism

Auto-approved actions use the same `executeAction` codepath which integrates with the Command pattern. Each command execution produces an `operationLogEntry` with an `undoToken`. The undo token is stored on the action's metadata.

Undo works identically to manually-accepted actions:
- `create_contact` auto-approved → undo soft-deletes the contact
- `create_order` auto-approved → undo soft-deletes the order
- `log_activity` auto-approved → undo removes the activity
- `link_contact` auto-approved → undo unlinks the contact

No additional undo infrastructure is needed — the existing command undo system handles it.

## Backend UI Changes

### Auto-Approved Badge on ActionCard

The `ActionCard` component gains an "Auto-approved" badge for executed actions that were auto-approved:

```typescript
// In ActionCard.tsx, within the executed status block:

if (action.status === 'executed') {
  return (
    <div className="border rounded-lg p-3 md:p-4 bg-green-50 dark:bg-green-950/20">
      <div className="flex items-center gap-2 mb-2">
        <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
        <span className="text-sm font-medium">{label}</span>
        {action.autoApproved && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
            <Zap className="h-3 w-3" />
            {t('inbox_ops.badge.auto_approved', 'Auto-approved')}
          </span>
        )}
      </div>
      {/* ... existing content ... */}
    </div>
  )
}
```

### Decision Trace Viewer

An expandable section below auto-approved actions showing the LLM's reasoning:

```typescript
// New component: components/proposals/DecisionTraceViewer.tsx

export function DecisionTraceViewer({ trace }: { trace: DecisionTrace }) {
  const t = useT()
  const [isExpanded, setIsExpanded] = React.useState(false)

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        {t('inbox_ops.decision_trace.title', 'Why was this auto-approved?')}
      </button>

      {isExpanded && (
        <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg text-xs space-y-2">
          <div>
            <span className="font-medium">{t('inbox_ops.decision_trace.reasoning', 'Reasoning')}:</span>
            <p className="mt-0.5 text-foreground/80">{trace.reasoning}</p>
          </div>

          {trace.rulesApplied.length > 0 && (
            <div>
              <span className="font-medium">{t('inbox_ops.decision_trace.rules_applied', 'Rules applied')}:</span>
              <ul className="mt-0.5 list-disc list-inside text-foreground/80">
                {trace.rulesApplied.map((rule, i) => <li key={i}>{rule}</li>)}
              </ul>
            </div>
          )}

          {trace.lessonsChecked.length > 0 && (
            <div>
              <span className="font-medium">{t('inbox_ops.decision_trace.lessons_checked', 'Lessons checked')}:</span>
              <ul className="mt-0.5 list-disc list-inside text-foreground/80">
                {trace.lessonsChecked.map((lesson, i) => <li key={i}>{lesson}</li>)}
              </ul>
            </div>
          )}

          <div className="text-muted-foreground">
            {t('inbox_ops.decision_trace.decided_at', 'Decided at')}: {new Date(trace.decidedAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  )
}
```

### Processing Log Enhancement

The processing log page (`/backend/inbox-ops/log`) already shows email processing status. Auto-approval events are visible through the proposal detail page — no changes needed to the log page itself. The proposal list page gains a visual indicator when a proposal has auto-approved actions (the `partial` status badge already conveys mixed state).

### Proposal Detail Page

The proposal detail page (`/backend/inbox-ops/proposals/[id]`) renders `ActionCard` for each action. The existing API response for proposal detail must include the new `autoApproved` and `decisionTrace` fields. Since these are standard entity fields, they are automatically included in the `findWithDecryption` result — no API route changes needed.

## Backward Compatibility

### No Breaking Changes

- **Entity fields:** Two new fields with defaults (`autoApproved = false`, `decisionTrace = null`). Existing actions are unaffected — they render as before with `autoApproved: false`.
- **API responses:** New fields are additive. Existing API consumers ignore unknown fields.
- **Events:** New event `inbox_ops.action.auto_approved` is additive. Existing subscribers are unaffected.
- **Notification types:** New type is additive. Existing notification renderers are unaffected.
- **Extraction pipeline:** Extended, not replaced. The auto-approval phase is a new step after existing persistence. If it fails, the pipeline continues with all actions in `pending` state — identical to current behavior.
- **ActionCard component:** Enhanced with conditional rendering for `autoApproved` badge and `DecisionTraceViewer`. Existing rendering paths unchanged.

### BC Surface Checklist

| Surface | Impact | Notes |
|---------|--------|-------|
| Auto-discovery | None | No new files that change routing |
| Type definitions | Additive | New optional fields on `ActionDetail`, new `DecisionTrace` type |
| Function signatures | Compatible | `evaluateAutoApproval` is new; existing functions unchanged |
| Import paths | None | New files only |
| Event IDs | Additive | New `inbox_ops.action.auto_approved` event |
| Widget injection | None | No new injection spots |
| API routes | Additive | Existing responses gain new optional fields |
| Database schema | Additive | New columns with defaults |
| DI service names | None | No new DI registrations |
| ACL feature IDs | None | No new features |
| Notification types | Additive | New `inbox_ops.action.auto_approved` type |

## Commit Plan

### Commit 1: Entity + Migration
- Add `autoApproved` and `decisionTrace` fields to `InboxProposalAction` entity in `data/entities.ts`
- Add `DecisionTrace` interface to `data/entities.ts`
- Update `[OptionalProps]` to include `autoApproved`
- Add `decisionTraceSchema`, `autoApprovalActionDecisionSchema`, `autoApprovalOutputSchema` to `data/validators.ts`
- Update `ActionDetail` type in `components/proposals/types.ts`
- Run `yarn db:generate` to produce migration

### Commit 2: Auto-Approval Prompt + LLM Call
- Create `lib/autoApprovalPrompt.ts` with `buildAutoApprovalSystemPrompt` and `buildAutoApprovalUserPrompt`
- Add `runAutoApprovalWithConfiguredProvider` to `lib/llmProvider.ts`
- Create `lib/autoApprovalEvaluator.ts` with `evaluateAutoApproval` function
- Add KB page loading by category helper

### Commit 3: Pipeline Integration + Execution
- Integrate `evaluateAutoApproval` into `subscribers/extractionWorker.ts` (Step 8.5)
- Add `executeAutoApprovedActions` to extractionWorker (Step 8.6)
- Add RBAC bypass for `SYSTEM_USER_ID` in `ensureUserCanExecuteAction`
- Add `inbox_ops.action.auto_approved` event to `events.ts`
- Emit new event from extractionWorker when auto-approved actions exist
- Update proposal creation event payload with auto-approval summary

### Commit 4: UI + Notifications
- Add "Auto-approved" badge to `ActionCard` executed state
- Create `DecisionTraceViewer` component
- Integrate `DecisionTraceViewer` into `ActionCard` for auto-approved executed actions
- Add `inbox_ops.action.auto_approved` notification type to `notifications.ts` and `notifications.client.ts`
- Create `subscribers/autoApprovalNotifier.ts`
- Add i18n keys to locale files

### Commit 5: Tests
- Unit tests for `buildAutoApprovalSystemPrompt` and `buildAutoApprovalUserPrompt`
- Unit tests for `evaluateAutoApproval` with mocked LLM responses
- Unit tests for RBAC bypass with `SYSTEM_USER_ID`
- Test: no KB pages → all actions stay pending
- Test: LLM failure → all actions stay pending
- Test: mixed decisions → correct autoApproved flags and decisionTrace
- Test: auto-approved action execution failure → autoApproved cleared
- Test: proposal status recalculation with auto-approved actions

## Integration Test Coverage

| Test ID | Scenario | Key Assertions |
|---------|----------|----------------|
| TC-AUTO-001 | Auto-approve with rules present | KB pages with auto-approval rules → matching actions get `autoApproved: true`, Decision Trace stored, actions executed with `SYSTEM_USER_ID` |
| TC-AUTO-002 | No auto-approval rules = all manual | No `auto_approval` KB pages → all actions stay `pending`, no Decision Trace |
| TC-AUTO-003 | Mixed proposal (some auto, some manual) | Some actions auto-approved, some pending → proposal status `partial` |
| TC-AUTO-004 | Undo auto-approved action | Auto-approved `create_contact` → undo via existing undo mechanism → contact soft-deleted |
| TC-AUTO-005 | Lessons blocking auto-approval | Lessons page says "never auto-approve conference contacts" → matching action stays pending despite meeting confidence threshold |
| TC-AUTO-006 | LLM failure fallback | Mock LLM timeout → all actions stay `pending`, warning logged, no crash |
| TC-AUTO-007 | Auto-approval notification | Auto-approved actions → notification created with correct type, body variables, and link |
| TC-AUTO-008 | Decision Trace in API response | GET proposal detail → auto-approved action includes `decisionTrace` with all required fields |
| TC-AUTO-009 | Auto-approved execution failure | Auto-approved action fails during execution → `autoApproved` cleared to false, action status `failed`, remaining auto-approved actions continue |

## Risks & Impact Review

### LLM Judgment Risk
**Risk:** The LLM might auto-approve actions that should require human review.
**Mitigation:** (1) No auto-approval without explicit KB rules — opt-in only. (2) Decision Trace provides full auditability. (3) Undo mechanism allows immediate reversal. (4) Lessons page creates a feedback loop — mistakes are fed back to prevent recurrence.

### False Positive Auto-Approval
**Risk:** A confidently-wrong action (e.g., creating a duplicate contact) gets auto-approved.
**Mitigation:** (1) The wiki can encode rules like "never auto-approve from conference emails." (2) The lessons page captures past mistakes. (3) Notifications alert users immediately after auto-approval, enabling quick undo.

### Extraction Latency Impact
**Risk:** The second LLM call adds latency to the extraction pipeline.
**Mitigation:** (1) The auto-approval call is smaller than extraction (fewer tokens — rules + action summaries, not full email content). Expected latency: 3-8 seconds. (2) The call is skipped entirely when no `auto_approval` KB pages exist. (3) Timeout is configurable via `INBOX_OPS_AUTO_APPROVAL_TIMEOUT_MS` (default 30s). (4) Timeout failure falls back to manual review — no user-visible degradation.

### Token Cost
**Risk:** Second LLM call doubles extraction cost.
**Mitigation:** (1) The auto-approval prompt is significantly smaller than the extraction prompt (no email content, no catalog products, no contact matching data). Estimated ~20-30% additional token usage. (2) Skipped when no KB pages exist. (3) The value proposition (automated execution vs. manual review queue) justifies the cost for tenants who opt in.

### SYSTEM_USER_ID and RBAC
**Risk:** Bypassing RBAC for system execution could be a security concern.
**Mitigation:** (1) The bypass is limited to `SYSTEM_USER_ID` (`00000000-0000-0000-0000-000000000000`) — not a real user. (2) Auto-approval is wiki-governed, not code-governed — the tenant controls what gets auto-approved. (3) All auto-approved actions have Decision Traces for audit. (4) The undo mechanism provides a safety net.

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-14 | Mat | Initial spec created |
