# Consuming Documents review findings from a module

`legal_review` is a worked example of a **consumer** of the Documents AI review
findings (spec `.ai/specs/2026-11-11-documents-ai-review-findings.md`). Documents
owns findings, playbooks, the findings panel and the `documents.review.cleared`
signal; it knows nothing about legal matters, agents or workflows. This module
adds those on top, using only public extension points:

| Piece | File | Extension point |
|-------|------|-----------------|
| Legal matter record (`legal_review_matters`) | `data/entities.ts`, `data/validators.ts`, `migrations/` | own entity, FK id `document_id` only (no ORM relation into Documents) |
| Matter CRUD API `/api/legal_review/matters` | `api/matters/route.ts` | `makeCrudRoute` + `openApi`, list filter `?documentId=` |
| Reviewer agent `legal_review.nda_reviewer` | `ai-agents.ts` | `defineAgent` + the Documents reviewer contract |
| NDA review workflow | `lib/ndaReviewWorkflow.ts`, `lib/seeds.ts`, `setup.ts` | example workflow definition seeded in `seedExamples` |
| Release command `legal_review.matter.release` | `commands/matters.ts`, `workflows.ts` | workflow-safe command for `UPDATE_ENTITY` |
| Clearance subscriber | `subscribers/review-cleared.ts` | persistent subscriber on `documents.review.cleared` |
| Matter header on the document page | `widgets/injection-table.ts`, `widgets/injection/matter-header/` | injection spot `detail:documents.document:header` |

The module is enabled in `apps/mercato/src/modules.ts` only when
`OM_ENABLE_ENTERPRISE_MODULES` and `OM_ENABLE_ENTERPRISE_MODULES_AGENTS` are true,
next to `agent_examples`, because `ai-agents.ts` imports the Agent Orchestrator SDK.

## 1. The reviewer agent

The agent is declared from the stable Documents contract
(`@open-mercato/documents/modules/documents/lib/reviewAgentContract`):

```ts
defineAgent({
  id: 'legal_review.nda_reviewer',
  moduleId: 'legal_review',
  label: 'NDA reviewer',
  description: 'Checks an NDA against the firm playbook and returns anchored findings.',
  instructions: buildDocumentReviewInstructions({ extra: NDA_REVIEW_GUIDANCE }),
  tools: [...DOCUMENT_REVIEW_TOOL_IDS],
  result: { kind: 'research', schema: documentReviewOutcomeSchema },
})
```

- `DOCUMENT_REVIEW_TOOL_IDS` are the two read-only Documents tools:
  `documents.get_document_for_review` (document blocks with section labels) and
  `documents.get_review_playbook` (rules, preferred wording, guidance documents).
- `buildDocumentReviewInstructions` carries the clause-by-clause procedure
  (verbatim quotes, severity from the rule, `suggestedText` from preferred
  wording, document text treated as data). `extra` adds the NDA-specific guidance.
- `documentReviewOutcomeSchema` validates the result as
  `{ kind: 'researcher', data: { findings, summary } }` — exactly what
  `documents.finding.ingest` accepts.

The agent is a researcher: it proposes nothing and never edits the document.

## 2. The NDA review workflow

Seeded per organization by `seedExamples` (skipped with `--no-examples`) as
`legal_review_nda_review_v1`:

```
START ─▶ ai_review  (INVOKE_AGENT legal_review.nda_reviewer, outputMapping { review: 'data' })
           ├─ researcher ─▶ [UPDATE_ENTITY documents.finding.ingest] ─▶ await_clearance (WAIT_FOR_SIGNAL documents_review_cleared)
           ├─ error ───────────▶ manual_review (USER_TASK)
           └─ guardrailBlocked ▶ manual_review (USER_TASK)
await_clearance ─▶ release (UPDATE_ENTITY legal_review.matter.release) ─▶ END
manual_review ──(manual)──▶ release
```

- Context input: `documentId` and `matterId` (required), `playbookCode`.
- The ingest input passes `findings: '{{context.review.findings}}'` as the
  **whole value**, so interpolation keeps the array type (proven by
  `TC-DOC-AGENT-001`).
- **Start every run with the correlation key `legal_review:<documentId>`**
  (`buildNdaReviewCorrelationKey`), for example through
  `POST /api/workflows/instances` with `correlationKey`. The clearance
  subscriber signals runs by that key.

Both `documents.finding.ingest` and `legal_review.matter.release` are new
workflow-safe candidates without `defaultEnabled`, so a tenant must enable them
in the workflow command policy (`/api/workflows/command-settings`). The example seed enables them for
demo tenants (keeping any grandfathered commands the tenant already ran). The
workflow user also needs `documents.edit` + the editor tier on the document, and
`legal_review.matters.manage`.

## 3. Waiting for clearance

`subscribers/review-cleared.ts` listens to `documents.review.cleared`
(`{ documentId, reviewId, decidedByUserId, tenantId, organizationId }`). The
event is a level-change notification, so the handler:

1. confirms the latest review still has zero open blocking findings
   (`countLatestReviewOpenBlocking`) and ignores stale or repeated events;
2. sends `documents_review_cleared` to runs parked under
   `legal_review:<documentId>` — the run then releases the matter itself;
3. when no run was waiting, releases the document's open matters directly.

`releaseLegalMatter` is idempotent: only `requested`/`review` matters move to
`released`, so repeats are no-ops.

## 4. The matter header

The documents page renders
`<InjectionSpot spotId="detail:documents.document:header" context={{ documentId, document, summary }} />`.
The widget (feature `legal_review.matters.view`) loads the matter with
`GET /api/legal_review/matters?documentId=…` and renders nothing when there is
none. It shows the reference, counterparty, purpose, chips (jurisdiction ·
agreement type · paper), "Asked by" / "Assignee" with avatars (display names
resolved server-side through the auth principal service, so viewers do not need
`auth.users.list`) and the four-step tracker Requested → Review → Released →
Signing with a status line such as "Avery Lin is reviewing · due in 3 days".

## Try it

1. Create a document with an NDA and a playbook with code `nda` (Documents →
   Review playbooks).
2. `POST /api/legal_review/matters` with `{ documentId, reference: 'LG-1042', counterparty: 'Northwind Traders', jurisdiction: 'DE', assigneeUserId }`.
3. Start `legal_review_nda_review_v1` with `{ documentId, matterId, playbookCode: 'nda' }`
   and correlation key `legal_review:<documentId>`.
4. Decide the blocking findings in the Changes panel; the matter moves to
   Released.

## Known limits

- A review with no blocking findings emits `documents.review.cleared` at ingest.
  If the subscriber handles it before the run parks on the wait step, no run is
  signalled; the subscriber then releases the matter directly and the run stays
  parked until it is cancelled or signalled again
  (`POST /api/workflows/signals` with the correlation key).
- The workflow is a database-seeded example rather than a code workflow
  (`defineWorkflow`), because code workflows do not model `INVOKE_AGENT`
  activities or outcome routes yet.

## Tests

- `__tests__/validators.test.ts` — matter input schemas.
- `__tests__/matter-header.test.ts` — header helpers, stage tracker, user labels.
- `__tests__/nda-review-workflow.test.ts` — the definition passes the workflows
  schema, outcome routing, whole-value ingest template, command enablement merge.
- `__integration__/TC-LEGAL-001.spec.ts` — matter CRUD, list by `documentId`,
  optimistic locking.
