# Inbox-Ops Enrichment Matching Pipeline

| Field | Value |
|-------|-------|
| **Status** | Approved |
| **Created** | 2026-04-14 |
| **App Spec** | `apps/mercato/app-spec/inbox-ops-lead-intake.md` |
| **Related Specs** | `2026-04-14-inbox-ops-crm-actions.md` (Spec 1), `2026-04-14-inbox-ops-knowledge-base.md` (Spec 2) |
| **Depends On** | Spec 1 (new discrepancy types added to `InboxDiscrepancyType` enum) |
| **Blocked By** | — |

## TLDR

Add an `enrichmentMatcher.ts` pipeline stage to inbox_ops that runs **before** the existing `contactMatcher` in the extraction worker. It determines whether an incoming email relates to existing CRM records by analyzing email headers (`In-Reply-To`, `References`), body content (email addresses, name+company mentions), and subject lines. The matcher produces deterministic outcomes (`single`, `multiple`, `none`, `low_confidence`) that steer the LLM toward enrichment actions (`update_contact`, `update_deal`) instead of creating new records. No new entities, no new API routes, no new UI — purely an internal pipeline stage.

## Technical Approach (Piotr)

1. **Mode:** Core module extension — new file inside `packages/core/src/modules/inbox_ops/lib/`.
2. **Separate from contactMatcher:** `contactMatcher.ts` matches extracted **participants** (name + email from thread headers) against CRM. `enrichmentMatcher.ts` matches the **email itself** (headers, body, subject) to existing CRM records. Different inputs, different confidence model, different output shape. Keeping them separate avoids a god-function and keeps each stage independently testable.
3. **Pipeline position:** enrichmentMatcher runs BEFORE contactMatcher in the extraction pipeline. Its results are passed to `buildExtractionSystemPrompt` as additional context so the LLM knows whether to propose `update_*` or `create_*` actions.
4. **Deterministic outcomes:** Match outcomes follow a fixed decision table — not delegated to the LLM or Knowledge Base. The LLM receives the outcome and acts on it, but doesn't decide it.
5. **No new entities or migrations.** The enrichment result is transient pipeline data passed to the prompt builder. Discrepancies (`ambiguous_match`, `low_confidence_match`, `pending_intake_match`) are persisted via the existing `InboxDiscrepancy` entity using the new types from Spec 1.

## Overview

When inbox-ops receives a follow-up or enrichment email about someone already in the CRM, it should recognize the connection and propose updates rather than creating duplicates. Today, the only matching happens at the participant level via `contactMatcher.ts` — it compares extracted participants' email addresses against CRM records. This works for commerce workflows where the sender IS the customer, but breaks for lead intake where a colleague or SDR agent forwards information ABOUT a lead they previously reported.

The enrichment matcher adds a pre-extraction pipeline stage that examines email metadata and body content to link the email to existing CRM entities, enabling the LLM to propose `update_contact`/`update_deal` instead of `create_contact`/`create_deal`.

## Problem Statement

Consider this sequence:
1. A colleague forwards an email from `john@acme.com` to the inbox — inbox-ops creates a proposal with `create_contact` + `create_deal`.
2. User accepts the proposal — John Doe from Acme Corp is created in CRM.
3. Later, the colleague forwards a scoring report: "RE: Lead - Acme Corp — Score: 85, Temperature: HOT."

Without enrichment matching, step 3 produces another `create_contact` proposal — a duplicate. The existing `contactMatcher` may catch it if John's email appears in the forwarded thread's headers, but it misses cases where the email is only referenced in the body text, or where the connection is only through thread headers (`In-Reply-To`).

## Proposed Solution

Introduce `enrichmentMatcher.ts` as a new pipeline stage that runs between email parsing and contact matching. It analyzes the incoming email using four progressively less reliable methods and produces a structured match result that the extraction prompt incorporates.

### Design Decisions

1. **Separate file, not an extension of contactMatcher.** The two matchers have different input shapes (email headers/body vs. participant name/email), different confidence models, and different output shapes. A combined function would require complex conditional logic and be harder to test in isolation.

2. **Runs before contactMatcher.** Enrichment matching operates on the raw email, not on extracted participants. Its output enriches the LLM prompt so the LLM knows whether the email relates to existing records. contactMatcher then matches the LLM-extracted participants as before.

3. **Deterministic outcomes.** Match outcomes (`single`, `multiple`, `none`, `low_confidence`) are computed by code, not by the LLM. The LLM is instructed to act on the outcome (propose updates vs. creates) but doesn't determine the outcome itself. This keeps matching auditable and predictable.

4. **Confidence threshold at 0.8.** Higher than contactMatcher's 0.7 because enrichment matching acts on email-level signals (fewer data points, higher stakes — wrong match means updating the wrong record).

5. **`pending_intake_match` as a discrepancy.** When the matched entity doesn't exist in CRM yet (referenced by a pending proposal that hasn't been accepted), the email falls through to `lead_intake` with a warning discrepancy. The user sees: "This email may be about someone from a pending proposal — accept that proposal first." This is a known v1 limitation; merge logic is deferred to v2.

### Alternatives Considered

**Extending contactMatcher with header/body analysis.** Rejected because contactMatcher iterates over a list of `{ name, email }` participants — adding header-based lookup would require a fundamentally different input type and control flow, making the function harder to reason about.

**LLM-driven matching.** Rejected because match outcomes must be deterministic for auditability. The LLM receives the match result and incorporates it into its extraction, but the match decision itself is code-driven. This also avoids burning LLM tokens on a task that regex + DB lookups handle reliably.

**Running enrichmentMatcher after contactMatcher.** Rejected because the enrichment result needs to be in the LLM prompt BEFORE extraction. If we ran it after, the LLM would have already decided to `create_contact` and we'd need a second LLM call or post-hoc correction.

## Architecture

```
Email arrives at webhook
        │
        ▼
   InboxEmail created
        │
        ▼
  extractionWorker starts
        │
        ├── 1. Build full text for extraction
        │
        ├── 2. *** enrichmentMatcher.matchEnrichment() ***    ← NEW
        │       Input:  InboxEmail (headers, body, subject)
        │       Output: EnrichmentMatchResult
        │       Queries: inbox_emails (by messageId), inbox_proposals + inbox_proposal_actions
        │                (by matchedEntityId/createdEntityId), CRM entities (by email, name)
        │
        ├── 3. contactMatcher.matchContacts()                  (unchanged)
        │       Input:  extracted participants (name + email)
        │       Output: ContactMatchResult[]
        │
        ├── 4. buildExtractionSystemPrompt()                   (modified)
        │       Input:  matchedContacts, catalogProducts,
        │               *** enrichmentMatch ***                ← NEW param
        │       Output: system prompt with enrichment context section
        │
        ├── 5. LLM generateObject()
        │       If enrichmentMatch.type === 'single':
        │         LLM instructed to propose update_contact/update_deal
        │       If enrichmentMatch.type === 'none':
        │         LLM proposes create_contact/create_deal (normal flow)
        │
        ├── 6. Persist proposal + actions + discrepancies
        │       If enrichmentMatch.type === 'multiple':
        │         Create ambiguous_match discrepancy
        │       If enrichmentMatch.type === 'low_confidence':
        │         Create low_confidence_match discrepancy
        │       If pending intake detected:
        │         Create pending_intake_match discrepancy
        │
        └── 7. Emit events (unchanged)
```

**Index requirement:** Method 1 queries `inbox_emails` by `messageId`. Verify that an index on `inbox_emails(message_id)` exists in the current migration set. If absent, add `@Index({ properties: ['messageId'] })` to `InboxEmail` and generate a migration.

## Data Models

### EnrichmentMatchResult

The primary output of `enrichmentMatcher.ts`. Represents the email-level match outcome.

```typescript
// packages/core/src/modules/inbox_ops/lib/enrichmentMatcher.ts

export type EnrichmentMatchType = 'single' | 'multiple' | 'none' | 'low_confidence'

export type EnrichmentMatchMethod =
  | 'thread_header'     // In-Reply-To / References → previous InboxEmail → created entity
  | 'email_in_body'     // Regex-extracted email from body → CRM primaryEmail lookup
  | 'name_company'      // Name + company in body → fuzzy CRM match
  | 'subject_reference' // Subject line contains identifiable company/person name

export interface EnrichmentCandidate {
  entityId: string
  entityType: 'person' | 'company'
  entityName: string
  confidence: number
  matchMethod: EnrichmentMatchMethod
}

export interface EnrichmentMatchResult {
  type: EnrichmentMatchType
  candidates: EnrichmentCandidate[]
  pendingIntakeProposalId?: string  // Set when match references a pending (unaccepted) proposal
}
```

### EnrichmentMatcherScope

Input scope for the matcher, reusing the tenant/org pattern from contactMatcher.

```typescript
export interface EnrichmentMatcherScope {
  tenantId: string
  organizationId: string
}

export interface EnrichmentMatcherDeps {
  customerEntityClass?: EntityClass<{
    id: string
    kind: string
    displayName: string
    primaryEmail?: string | null
    tenantId?: string
    organizationId?: string
    deletedAt?: Date | null
    createdAt?: Date
  }>
}
```

## API Contracts

No new API routes are introduced. The enrichment matcher is an internal pipeline function invoked by the `extractionWorker` subscriber. The integration point is the function signature:

```typescript
export async function matchEnrichment(
  em: EntityManager,
  email: InboxEmail,
  scope: EnrichmentMatcherScope,
  deps?: EnrichmentMatcherDeps,
): Promise<EnrichmentMatchResult>
```

**Caller:** `extractionWorker.ts` — invoked at step 2, before `matchContacts`.

**Consumer:** `buildExtractionSystemPrompt` — receives the result as a new optional parameter and injects an `<enrichment_context>` section into the system prompt.

## Matching Algorithm

The matcher runs four methods in priority order. Each method may produce zero or more `EnrichmentCandidate` entries. After all methods run, the candidates are deduplicated by `entityId` (keeping the highest-confidence entry per entity) and the outcome is determined.

### Method 1: Thread Header Matching (confidence: 1.0)

**Input:** `email.inReplyTo`, `email.emailReferences` (RFC 2822 headers)

**Logic:**
1. Collect all message IDs from `inReplyTo` (single value) and `emailReferences` (array). Skip if both are empty/null.
2. Query `inbox_emails` for records with matching `messageId` values, scoped to the same tenant/org.
3. For each matched InboxEmail, look up its associated `inbox_proposals` (via `inboxEmailId`).
4. For each proposal, query `inbox_proposal_actions` for actions with `status = 'executed'` and non-null `createdEntityId` (these are entities that were actually created from a previous email in this thread).
5. Also query actions with `status = 'executed'` and non-null `matchedEntityId` (entities that were linked/updated from this thread).
6. Each found entity becomes a candidate with `confidence: 1.0` and `matchMethod: 'thread_header'`.
7. **Pending intake detection:** If the proposal's status is `'pending'` and the action's `createdEntityId` is null (not yet executed), record the proposal ID for the `pending_intake_match` discrepancy but do NOT add a candidate — the entity doesn't exist yet.

```typescript
async function matchByThreadHeaders(
  em: EntityManager,
  email: InboxEmail,
  scope: EnrichmentMatcherScope,
): Promise<{ candidates: EnrichmentCandidate[]; pendingProposalId?: string }> {
  const messageIds: string[] = []
  if (email.inReplyTo) messageIds.push(email.inReplyTo)
  if (email.emailReferences?.length) messageIds.push(...email.emailReferences)

  if (messageIds.length === 0) return { candidates: [] }

  // Find previous emails in this thread
  const previousEmails = await em.find(InboxEmail, {
    messageId: { $in: messageIds },
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })

  if (previousEmails.length === 0) return { candidates: [] }

  const previousEmailIds = previousEmails.map((e) => e.id)

  // Find proposals for those emails
  const proposals = await em.find(InboxProposal, {
    inboxEmailId: { $in: previousEmailIds },
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })

  if (proposals.length === 0) return { candidates: [] }

  const candidates: EnrichmentCandidate[] = []
  let pendingProposalId: string | undefined

  const proposalIds = proposals.map((p) => p.id)
  const allActions = await em.find(InboxProposalAction, {
    proposalId: { $in: proposalIds },
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })

  // Group actions by proposalId
  const actionsByProposal = new Map<string, InboxProposalAction[]>()
  for (const action of allActions) {
    const list = actionsByProposal.get(action.proposalId) ?? []
    list.push(action)
    actionsByProposal.set(action.proposalId, list)
  }

  for (const proposal of proposals) {
    const actions = actionsByProposal.get(proposal.id) ?? []

    for (const action of actions) {
      if (action.status === 'executed' && action.createdEntityId && action.createdEntityType) {
        candidates.push({
          entityId: action.createdEntityId,
          entityType: action.createdEntityType as 'person' | 'company',
          entityName: extractEntityNameFromPayload(action.payload),
          confidence: 1.0,
          matchMethod: 'thread_header',
        })
      }
      if (action.status === 'executed' && action.matchedEntityId && action.matchedEntityType) {
        candidates.push({
          entityId: action.matchedEntityId,
          entityType: action.matchedEntityType as 'person' | 'company',
          entityName: extractEntityNameFromPayload(action.payload),
          confidence: 1.0,
          matchMethod: 'thread_header',
        })
      }

      // Detect pending intake — proposal not yet accepted
      if (proposal.status === 'pending' && action.status === 'pending' && !action.createdEntityId) {
        if (action.actionType === 'create_contact' || action.actionType === 'create_deal') {
          pendingProposalId = proposal.id
        }
      }
    }
  }

  return { candidates, pendingProposalId }
}
```

### Method 2: Email-in-Body Matching (confidence: 0.95)

**Input:** `email.rawText` or `email.cleanedText` (email body content)

**Logic:**
1. Extract all email addresses from the body text using a regex. Exclude the inbox's own address (`email.toAddress`) and the forwarder's address (`email.forwardedByAddress`).
2. For each extracted email address, query CRM (`customerEntityClass`) by `primaryEmail` using `findOneWithDecryption` (handles encrypted fields).
3. Each matched CRM record becomes a candidate with `confidence: 0.95` and `matchMethod: 'email_in_body'`.

```typescript
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

async function matchByEmailInBody(
  em: EntityManager,
  email: InboxEmail,
  scope: EnrichmentMatcherScope,
  deps?: EnrichmentMatcherDeps,
): Promise<EnrichmentCandidate[]> {
  if (!deps?.customerEntityClass) return []

  const bodyText = email.rawText || email.cleanedText || ''
  if (!bodyText.trim()) return []

  const foundEmails = [...new Set(
    (bodyText.match(EMAIL_REGEX) || []).map((e) => e.toLowerCase()),
  )]

  // Exclude the inbox address and forwarder
  const excludeSet = new Set<string>()
  if (email.toAddress) excludeSet.add(email.toAddress.toLowerCase())
  if (email.forwardedByAddress) excludeSet.add(email.forwardedByAddress.toLowerCase())

  const emailsToCheck = foundEmails.filter((e) => !excludeSet.has(e))

  const candidates: EnrichmentCandidate[] = []

  for (const addr of emailsToCheck) {
    const match = await findOneWithDecryption(
      em,
      deps.customerEntityClass,
      {
        primaryEmail: addr,
        deletedAt: null,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      },
      undefined,
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )

    if (match) {
      candidates.push({
        entityId: match.id,
        entityType: match.kind === 'company' ? 'company' : 'person',
        entityName: match.displayName || addr,
        confidence: 0.95,
        matchMethod: 'email_in_body',
      })
    }
  }

  return candidates
}
```

### Shared: Load CRM Records for Methods 3 + 4

Methods 3 and 4 both need the same set of CRM records for fuzzy matching. To avoid a duplicate `findWithDecryption` call with `limit: 200` on the same entity/filters, a shared loader is extracted:

```typescript
async function loadCrmRecords(
  em: EntityManager,
  scope: EnrichmentMatcherScope,
  deps?: EnrichmentMatcherDeps,
): Promise<Array<{ id: string; kind: string; displayName: string; primaryEmail?: string | null }>> {
  if (!deps?.customerEntityClass) return []

  return findWithDecryption(
    em,
    deps.customerEntityClass,
    {
      deletedAt: null,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
    { limit: 200, orderBy: { createdAt: 'DESC' } },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}
```

### Method 3: Name + Company Matching (confidence: 0.7)

**Input:** `email.rawText` or `email.cleanedText` (email body), `email.subject`

**Logic:**
1. Receive pre-loaded CRM records from the shared `loadCrmRecords` call (up to 200 records, newest first).
2. For each CRM record with a `displayName`, search the body text for the name.
3. Scoring:
   - Exact full name found in body: `0.85`
   - Full name found in subject: `0.8`
   - Partial name match (first or last name in body, 3+ characters): `0.7`
4. Company records use the same logic against `displayName`.
5. Candidates below `0.7` are discarded.

```typescript
function matchByNameCompany(
  email: InboxEmail,
  crmRecords: Array<{ id: string; kind: string; displayName: string; primaryEmail?: string | null }>,
): EnrichmentCandidate[] {
  const bodyText = (email.rawText || email.cleanedText || '').toLowerCase()
  const subjectText = (email.subject || '').toLowerCase()

  if (!bodyText.trim() && !subjectText.trim()) return []

  const candidates: EnrichmentCandidate[] = []

  for (const record of crmRecords) {
    const name = (record.displayName || '').trim()
    if (!name || name.length < 3) continue

    const nameLower = name.toLowerCase()
    let confidence = 0

    // Exact full name in body
    if (bodyText.includes(nameLower)) {
      confidence = 0.85
    }
    // Exact full name in subject
    else if (subjectText.includes(nameLower)) {
      confidence = 0.8
    }
    // Partial name match — check first/last name parts (3+ chars each)
    else {
      const parts = nameLower.split(/\s+/).filter((p) => p.length >= 3)
      const partInBody = parts.some((part) => bodyText.includes(part))
      if (partInBody && parts.length > 1) {
        confidence = 0.7
      }
    }

    if (confidence >= 0.7) {
      candidates.push({
        entityId: record.id,
        entityType: record.kind === 'company' ? 'company' : 'person',
        entityName: record.displayName || '',
        confidence,
        matchMethod: 'name_company',
      })
    }
  }

  return candidates
}
```

### Method 4: Subject Reference Matching (confidence: 0.5)

**Input:** `email.subject`

**Logic:**
1. Extract potential entity names from subject line patterns:
   - `"RE: Lead - {name}"` → extract `{name}`
   - `"FW: {name} - Scoring Report"` → extract `{name}`
   - `"RE: {name}"` → extract `{name}` (general reply pattern)
2. Search CRM `displayName` for matches against extracted names.
3. Candidates get `confidence: 0.5` and `matchMethod: 'subject_reference'`.
4. At `0.5`, these candidates are always below the `0.8` threshold, so they only contribute when combined with higher-confidence methods or result in a `low_confidence` outcome.

```typescript
// Locale-aware email prefixes: EN (RE/FW/Fwd), DE (AW/WG), SV (SV/VB), FR (TR), ES (RV), IT (RIF/I), NL (Antw), PT (RES/ENC)
const REPLY_FWD_PREFIX = '(?:RE|AW|SV|RV|FW|Fwd|WG|TR|RIF|I|Antw|RES|ENC|VB)'

const SUBJECT_PATTERNS = [
  new RegExp(`^${REPLY_FWD_PREFIX}:\\s*Lead\\s*[-–]\\s*(.+?)(?:\\s*[-–]|$)`, 'i'),
  new RegExp(`^${REPLY_FWD_PREFIX}:\\s*(.+?)\\s*[-–]\\s*(?:Scoring|Score|Report|Update|Notes)`, 'i'),
  new RegExp(`^${REPLY_FWD_PREFIX}:\\s*(.+?)$`, 'i'),
]

function matchBySubjectReference(
  email: InboxEmail,
  crmRecords: Array<{ id: string; kind: string; displayName: string; primaryEmail?: string | null }>,
): EnrichmentCandidate[] {
  const subject = (email.subject || '').trim()
  if (!subject) return []

  let extractedName: string | null = null
  for (const pattern of SUBJECT_PATTERNS) {
    const match = subject.match(pattern)
    if (match?.[1]) {
      extractedName = match[1].trim()
      break
    }
  }

  if (!extractedName || extractedName.length < 3) return []

  const nameLower = extractedName.toLowerCase()

  const candidates: EnrichmentCandidate[] = []

  for (const record of crmRecords) {
    const displayName = (record.displayName || '').toLowerCase().trim()
    if (!displayName) continue

    if (displayName === nameLower || displayName.includes(nameLower) || nameLower.includes(displayName)) {
      candidates.push({
        entityId: record.id,
        entityType: record.kind === 'company' ? 'company' : 'person',
        entityName: record.displayName || '',
        confidence: 0.5,
        matchMethod: 'subject_reference',
      })
    }
  }

  return candidates
}
```

### Outcome Determination

After all four methods run, candidates are deduplicated and the outcome is computed:

```typescript
const ENRICHMENT_CONFIDENCE_THRESHOLD = 0.8

function determineOutcome(
  allCandidates: EnrichmentCandidate[],
  pendingProposalId?: string,
): EnrichmentMatchResult {
  // Deduplicate by entityId, keeping highest confidence per entity
  const byEntity = new Map<string, EnrichmentCandidate>()
  for (const candidate of allCandidates) {
    const existing = byEntity.get(candidate.entityId)
    if (!existing || candidate.confidence > existing.confidence) {
      byEntity.set(candidate.entityId, candidate)
    }
  }

  const uniqueCandidates = [...byEntity.values()]
    .sort((a, b) => b.confidence - a.confidence)

  // No candidates at all
  if (uniqueCandidates.length === 0) {
    return { type: 'none', candidates: [], pendingIntakeProposalId: pendingProposalId }
  }

  // Filter to candidates above threshold
  const aboveThreshold = uniqueCandidates.filter(
    (c) => c.confidence >= ENRICHMENT_CONFIDENCE_THRESHOLD,
  )

  // Multiple distinct entities above threshold
  if (aboveThreshold.length > 1) {
    return { type: 'multiple', candidates: aboveThreshold, pendingIntakeProposalId: pendingProposalId }
  }

  // Exactly one entity above threshold
  if (aboveThreshold.length === 1) {
    return { type: 'single', candidates: aboveThreshold, pendingIntakeProposalId: pendingProposalId }
  }

  // Candidates exist but none above threshold — low confidence
  const bestCandidate = uniqueCandidates[0]
  return { type: 'low_confidence', candidates: [bestCandidate], pendingIntakeProposalId: pendingProposalId }
}
```

### Helper: Extract Entity Name from Payload

Used by thread header matching to retrieve a human-readable name from the action payload.

```typescript
function extractEntityNameFromPayload(payload: Record<string, unknown>): string {
  if (typeof payload.name === 'string') return payload.name
  if (typeof payload.contactName === 'string') return payload.contactName
  if (typeof payload.title === 'string') return payload.title
  // Spec 1 CRM action payloads
  if (typeof payload.entityId === 'string') return `entity:${payload.entityId}`
  if (typeof payload.dealId === 'string') return `deal:${payload.dealId}`
  return ''
}
```

### Top-Level Function

```typescript
export async function matchEnrichment(
  em: EntityManager,
  email: InboxEmail,
  scope: EnrichmentMatcherScope,
  deps?: EnrichmentMatcherDeps,
): Promise<EnrichmentMatchResult> {
  const allCandidates: EnrichmentCandidate[] = []
  let pendingProposalId: string | undefined

  // Method 1: Thread headers (highest reliability)
  const headerResult = await matchByThreadHeaders(em, email, scope)
  allCandidates.push(...headerResult.candidates)
  if (headerResult.pendingProposalId) pendingProposalId = headerResult.pendingProposalId

  // Method 2: Email addresses in body
  const emailBodyCandidates = await matchByEmailInBody(em, email, scope, deps)
  allCandidates.push(...emailBodyCandidates)

  // Method 3 + 4: Share CRM records
  const crmRecords = await loadCrmRecords(em, scope, deps)
  const nameCompanyCandidates = matchByNameCompany(email, crmRecords)
  allCandidates.push(...nameCompanyCandidates)

  // Method 4: Subject line reference
  const subjectCandidates = matchBySubjectReference(email, crmRecords)
  allCandidates.push(...subjectCandidates)

  return determineOutcome(allCandidates, pendingProposalId)
}
```

## Pipeline Integration

### extractionWorker.ts Changes

The enrichment matcher is invoked in the extraction worker between full text construction and contact matching:

```typescript
// Step 1: Build full text (unchanged)
const fullText = buildFullTextForExtraction(email)

// Step 2: NEW — Enrichment matching (before contactMatcher)
const enrichmentMatch = await matchEnrichment(em, email, scope,
  entityClasses.customerEntity ? { customerEntityClass: entityClasses.customerEntity } : undefined,
)

// Step 2b: Contact matching (unchanged, moved to step 2b)
const threadParticipants = extractParticipantsFromThread(email)
const contactMatches = await matchContacts(em, threadParticipants, scope, ...)

// Step 3: Build prompt with enrichment context
const systemPrompt = await buildExtractionSystemPrompt({
  matchedContacts: contactMatches,
  catalogProducts,
  workingLanguage,
  knowledgePages,     // from Spec 2 (loaded earlier in worker)
  enrichmentMatch,    // NEW — added by this spec
})
```

### buildExtractionSystemPrompt Changes

Add `enrichmentMatch` to the `ExtractionPromptOptions` interface (refactored by Spec 2 from positional params to options object) and inject enrichment context into the prompt:

```typescript
// Addition to ExtractionPromptOptions (defined by Spec 2)
interface ExtractionPromptOptions {
  // ... existing fields from Spec 2 ...
  enrichmentMatch?: EnrichmentMatchResult  // NEW — added by this spec
}

export async function buildExtractionSystemPrompt(
  options: ExtractionPromptOptions,
): Promise<string> {
  // ... existing logic ...

  const enrichmentSection = buildEnrichmentSection(options.enrichmentMatch)

  return `<role>
You are an email-to-ERP extraction agent.
</role>
${enrichmentSection}
<!-- ...rest of existing prompt... -->`
}
```

The enrichment section content varies by outcome:

```typescript
function buildEnrichmentSection(match?: EnrichmentMatchResult): string {
  if (!match || match.type === 'none') return ''

  if (match.type === 'single') {
    const candidate = match.candidates[0]
    return `
<enrichment_context>
This email matches an EXISTING CRM record:
- Entity: ${candidate.entityName} (${candidate.entityType}, ID: ${candidate.entityId})
- Match confidence: ${candidate.confidence}
- Match method: ${candidate.matchMethod}

IMPORTANT: Propose update_contact / update_deal actions instead of create_contact / create_deal for this entity.
Set matchedEntityId to "${candidate.entityId}" on update actions.
You may still propose create_deal if the email describes a NEW opportunity for this existing contact.
</enrichment_context>`
  }

  if (match.type === 'low_confidence') {
    const candidate = match.candidates[0]
    return `
<enrichment_context>
This email MIGHT match an existing CRM record (low confidence):
- Entity: ${candidate.entityName} (${candidate.entityType}, ID: ${candidate.entityId})
- Match confidence: ${candidate.confidence}
- Match method: ${candidate.matchMethod}

Prefer update_contact / update_deal if the email content confirms this is the same entity.
If uncertain, propose create_contact instead — the user will resolve the ambiguity.
</enrichment_context>`
  }

  if (match.type === 'multiple') {
    const candidateList = match.candidates
      .map((c) => `  - ${c.entityName} (${c.entityType}, ID: ${c.entityId}, confidence: ${c.confidence})`)
      .join('\n')
    return `
<enrichment_context>
This email matches MULTIPLE existing CRM records (ambiguous):
${candidateList}

Do NOT assume which record this email is about. Propose create_contact as fallback.
The user will resolve the ambiguous match via a discrepancy.
</enrichment_context>`
  }

  return ''
}
```

### Discrepancy Creation

In the extraction worker, after the proposal is created, enrichment-related discrepancies are persisted:

```typescript
// After proposal + actions are created:
if (enrichmentMatch.type === 'multiple') {
  createDiscrepancy(em, proposalId, allActions, {
    type: 'ambiguous_match',
    severity: 'warning',
    description: 'inbox_ops.discrepancy.desc.ambiguous_match',
    foundValue: enrichmentMatch.candidates.map((c) => c.entityName).join(', '),
  }, scope)
}

if (enrichmentMatch.type === 'low_confidence') {
  createDiscrepancy(em, proposalId, allActions, {
    type: 'low_confidence_match',
    severity: 'warning',
    description: 'inbox_ops.discrepancy.desc.low_confidence_match',
    foundValue: `${enrichmentMatch.candidates[0]?.entityName} (${enrichmentMatch.candidates[0]?.confidence})`,
  }, scope)
}

if (enrichmentMatch.pendingIntakeProposalId) {
  createDiscrepancy(em, proposalId, allActions, {
    type: 'pending_intake_match',
    severity: 'warning',
    description: 'inbox_ops.discrepancy.desc.pending_intake_match',
    expectedValue: enrichmentMatch.pendingIntakeProposalId,
  }, scope)
}
```

### matchedEntityId on Actions

When `enrichmentMatch.type === 'single'` and the LLM produces `update_contact` or `update_deal` actions, the `matchedEntityId` is set from the enrichment candidate. The existing `InboxProposalAction.matchedEntityId` field is already designed for this purpose — no schema change needed.

The extraction worker sets `matchedEntityId` on actions that target the enrichment-matched entity:

```typescript
// When persisting actions, if enrichment found a single match:
if (enrichmentMatch.type === 'single') {
  const matchedEntityId = enrichmentMatch.candidates[0]?.entityId
  for (const action of allActions) {
    if (
      matchedEntityId &&
      (action.actionType === 'update_contact' || action.actionType === 'update_deal')
    ) {
      action.matchedEntityId = matchedEntityId
      action.matchedEntityType = enrichmentMatch.candidates[0]?.entityType || null
    }
  }
}
```

## Backward Compatibility

1. **contactMatcher.ts is unchanged.** No modifications to its function signature, behavior, or output shape.

2. **`ExtractionPromptOptions` gains an optional `enrichmentMatch` field.** Spec 2 refactors `buildExtractionSystemPrompt` from positional params to an `ExtractionPromptOptions` interface and adds `knowledgePages`. This spec adds `enrichmentMatch?: EnrichmentMatchResult` to the same interface. Because the interface uses named fields (not positional params), no coordination risk exists. When `enrichmentMatch` is absent or `type: 'none'`, no enrichment section is injected — identical behavior to before. **Cross-spec dependency:** implementation of Spec 3 assumes Spec 2's options object refactoring is already in place.

3. **Extraction output schema is unchanged.** The LLM is instructed to use `update_contact`/`update_deal` action types which are being added by Spec 1. No changes to `extractionOutputSchema` in this spec.

4. **New discrepancy types (`ambiguous_match`, `low_confidence_match`, `pending_intake_match`) are additive.** They are added to the `InboxDiscrepancyType` union by Spec 1. Existing discrepancy handling code uses a type union — adding new members is a non-breaking change.

5. **Emails without enrichment signals pass through with `none` outcome.** Commerce-focused emails (order, RFQ, shipping) that have no CRM context produce `type: 'none'` from the enrichment matcher, which means no enrichment section in the prompt and no change in behavior.

6. **No database schema changes.** The enrichment matcher reads existing tables (`inbox_emails`, `inbox_proposals`, `inbox_proposal_actions`, CRM entities) and produces transient in-memory results. Discrepancies use the existing `inbox_discrepancies` table with new type values from Spec 1.

## Commit Plan

### Commit 1: Implement `enrichmentMatcher.ts`

**Files created:**
- `packages/core/src/modules/inbox_ops/lib/enrichmentMatcher.ts`

**Contents:**
- `EnrichmentMatchResult`, `EnrichmentCandidate`, `EnrichmentMatchType`, `EnrichmentMatchMethod` type exports
- `matchEnrichment()` — top-level orchestrator
- `matchByThreadHeaders()` — In-Reply-To / References header lookup
- `matchByEmailInBody()` — regex email extraction + CRM lookup
- `matchByNameCompany()` — fuzzy name/company search
- `matchBySubjectReference()` — subject line pattern matching
- `determineOutcome()` — deduplication + threshold-based outcome computation
- `extractEntityNameFromPayload()` — helper

### Commit 2: Integrate into extraction pipeline

**Prerequisite:** Spec 2, Commit 2 (refactoring `buildExtractionSystemPrompt` from positional params to `ExtractionPromptOptions` object) must be merged first. This commit adds `enrichmentMatch` to that options interface.

**Files modified:**
- `packages/core/src/modules/inbox_ops/subscribers/extractionWorker.ts` — invoke `matchEnrichment()` before `matchContacts()`, pass result to prompt builder, create enrichment discrepancies
- `packages/core/src/modules/inbox_ops/lib/extractionPrompt.ts` — add `enrichmentMatch` field to `ExtractionPromptOptions` interface, add `buildEnrichmentSection()` helper

**Files added:**
- i18n entries for `inbox_ops.discrepancy.desc.ambiguous_match`, `inbox_ops.discrepancy.desc.low_confidence_match`, `inbox_ops.discrepancy.desc.pending_intake_match`

### Commit 3: Unit tests

**Files created:**
- `packages/core/src/modules/inbox_ops/lib/__tests__/enrichmentMatcher.test.ts`

**Test coverage:**
- `matchByThreadHeaders`: valid In-Reply-To chain, References array, no headers, pending intake detection
- `matchByEmailInBody`: email found in body, email not in CRM, inbox address excluded, forwarder excluded
- `matchByNameCompany`: exact name match, partial match, below threshold, company match
- `matchBySubjectReference`: "RE: Lead - Acme Corp" pattern, no match, short name ignored
- `determineOutcome`: single match, multiple matches, no matches, low confidence, deduplication, pending proposal
- `matchEnrichment` integration: combines all methods, highest-confidence wins dedup
- Edge cases: empty body, null headers, no customer entity class (graceful no-op)

## Integration Test Coverage

| Test ID | Scenario | Steps | Expected |
|---------|----------|-------|----------|
| TC-ENRICH-001 | Thread-linked enrichment | 1. Send lead email, accept create_contact action. 2. Send reply (In-Reply-To references original). 3. Verify proposal has `update_contact` action with `matchedEntityId` set. | Proposal category is `lead_enrichment`, no duplicate `create_contact` |
| TC-ENRICH-002 | Email-in-body match | 1. Create CRM contact with email `john@acme.com`. 2. Send email with body mentioning `john@acme.com`. 3. Verify enrichment match found. | Proposal proposes `update_contact` for the existing record |
| TC-ENRICH-003 | Ambiguous match discrepancy | 1. Create two CRM contacts at `john@acme.com` and `john@other.com`. 2. Send email body mentioning both emails. 3. Verify `ambiguous_match` discrepancy created. | Discrepancy severity is `warning`, both entity names listed |
| TC-ENRICH-004 | No match fallthrough | 1. Send email with no CRM-matchable content. 2. Verify enrichment result is `none`. 3. Verify proposal has `create_contact` (not `update_contact`). | Normal lead_intake flow, no enrichment discrepancies |
| TC-ENRICH-005 | Pending intake match | 1. Send lead email (creates pending proposal). 2. Do NOT accept the proposal. 3. Send enrichment email referencing the same thread (In-Reply-To). 4. Verify `pending_intake_match` discrepancy. | Discrepancy `expectedValue` contains the pending proposal ID |
| TC-ENRICH-006 | Low confidence match | 1. Create CRM contact "John Doe". 2. Send email with subject "RE: John" (subject_reference only, confidence 0.5). 3. Verify `low_confidence_match` discrepancy. | Single candidate below threshold, type is `low_confidence` |
| TC-ENRICH-007 | Commerce email passthrough | 1. Send a standard order email (no CRM context). 2. Verify enrichment result is `none`. 3. Verify normal commerce extraction proceeds unchanged. | No enrichment section in prompt, existing behavior preserved |

## Risks & Impact Review

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Performance:** Methods 3 and 4 fetch up to 200 CRM records into memory for fuzzy matching. For tenants with thousands of contacts, this could be slow. | Medium | Limit to 200 records (newest first). If insufficient, Method 3/4 produce fewer candidates — Methods 1/2 (targeted queries) handle the high-value cases. Future: add query index lookup or search index query. |
| **False positives in name matching:** Short or common names ("John", "Sales") could match many CRM records, producing `multiple` outcomes. | Medium | Minimum name length filter (3 chars). Partial name matching requires multi-part names. `multiple` outcome creates discrepancy for user resolution rather than acting on bad data. |
| **Email regex in body text:** The regex may extract email addresses from signatures, disclaimers, or quoted text that aren't relevant to the enrichment. | Low | The inbox/forwarder addresses are excluded. False matches against CRM result in `multiple` or `low_confidence` outcomes, both surfaced to the user. No destructive action is taken on a false match. |
| **Thread header gap:** If the original lead email was not processed by inbox-ops (sent before the feature was enabled), `matchByThreadHeaders` won't find it. | Low | Methods 2-4 provide fallback matching. Thread header matching is best-effort — it works when inbox-ops has history, degrades gracefully when it doesn't. |
| **Encrypted CRM fields:** `findOneWithDecryption` and `findWithDecryption` handle encrypted `primaryEmail` fields. If encryption is misconfigured, lookups return empty results. | Low | Same risk as existing `contactMatcher` — the mitigation (graceful fallback to no match) is already established. |
| **Spec 1 dependency:** New discrepancy types must be added to `InboxDiscrepancyType` before this code can compile. | None (sequenced) | Spec 1 is implemented first. This spec's Commit 1 imports the types; if they don't exist, TypeScript catches it at build time. |

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-14 | Mat | Initial spec created |
| 2026-04-14 | Review | Updated `buildExtractionSystemPrompt` to use `ExtractionPromptOptions` object (refactored by Spec 2) instead of positional param #7. |
