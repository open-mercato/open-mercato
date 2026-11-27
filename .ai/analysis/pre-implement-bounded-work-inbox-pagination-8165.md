# Pre-implementation analysis: bounded Work Inbox pagination (#8165)

**Readiness: no-go** — the proposal needs architecture/contract approval and an
approved legacy-provider/diagnostic transition. No production fix is authorized
or shipped. This is an author audit, not an independent maintainer approval.

Spec: `.ai/specs/2026-11-22-bounded-work-inbox-pagination.md` and its enterprise
addendum; audited 2026-11-22 at c98419720f. Template:
`.ai/skills/om-spec-writing/references/spec-template.md`.

## Blocking before implementation

1. **Critical / readiness:** Status is Draft and Q1–Q4 are unconfirmed. Root AGENTS.md
   Ask First gates architecture; packages/core/AGENTS.md Ask First explicitly gates
   any public type/contract. A generic security-fix authorization does not waive
   either. Obtain named approval of the concrete optional capability and order.
2. **Critical / compatibility decision:** Keeping `list` callable is not a bridge
   for its participation in merged HTTP pages. Dropping unsupported providers and
   narrowing diagnostics to a page changes current behavior. The spec correctly
   discloses this but does not possess an approved transition. Choose a compliant
   bridge/versioning decision; if requesting the Emergency Security Exception,
   establish eligibility and obtain a named human waiver before cutover. Do not
   infer a waiver from security labels or keep a vulnerable fallback and call it fixed.
3. **Critical / readiness R4:** The provider relation transport is proposed rather
   than frozen. Before approval, prove parameter binding/placeholder composition,
   scoped ORM where compilation, transaction-affine execution and savepoint recovery
   on the installed ORM. Resolve the final signature in the spec; a runtime agent
   must not invent it during implementation.

## Readiness gate

| Item | Result | Evidence / next action |
|---|---|---|
| R1 declared status | Fail | Both documents explicitly Draft; obtain approval before Accepted. |
| R2 decisions confirmed | Fail | Q1–Q4 carry NEEDS HUMAN CONFIRMATION with no approval in the issue's complete comment/event history inspected at intake. |
| R3 traceability | Pass as design | A1–A10 map page budget/order/hidden/empty/scope/failure/consumer behavior to Phase 1/2 and self-contained oracles. They are not executed regressions. |
| R4 contracts frozen | Fail | Raw query-fragment shape and ORM composition spike remain explicit proof obligations. |
| R5 phases/exit gates | Pass as plan | Phase 0 blocks runtime work; additive Phase 1 and coordinated Phase 2 have dependencies and measured exits. |
| R6 grounded | Pass within audit limits | Provider path, fields, DI key, route schemas, where helpers, comparator, next consumer and optional registration checked in source. Proposed pieces are explicitly labelled new. |

## Backward compatibility

The spec inventories every numbered category **§1–§14** in the actual BC document
(the root's remembered count of 13 is not used). Phase 0 changes documents only.
Phase 1 proposes additive §2 types at the existing §4 import path. Phase 2 changes
§3 comparator/coordinator behavior, §7 diagnostic coverage/provider participation,
and §9 service behavior while retaining required shapes and keys. All other
numbered categories are unchanged in every phase. No config/startup change.

The migration section and parent-integrated release disclosure are required, but
writing migration prose cannot grant a behavioral-break waiver. Dated exceptions
for #7534 and unrelated security fixes do not authorize #8165. A potential future
exception is not an approval already obtained. Proposed legacy bridge duration
is at least one minor; vulnerable prefix invocation cannot remain a security fix.

## Findings from the five specification-review lenses

- **Blocker / backward compatibility and gaps:** The three gate findings above
  prevent implementation readiness. Their remedy is explicit approval and a
  frozen/proven provider transport, not more runtime code in this draft PR.
- **Major / failure risk:** A virtual SQL union can turn a single provider query
  fault into a transaction failure. The draft specifies savepoints, source-owned
  failures, bounded reselection and system-error handling, but these are untested.
  Required remedy is database-backed source-failure/snapshot proof before rollout.
- **Major / performance risk:** Database OFFSET still computes skipped keys, and
  exact counts scan candidates. The design meets the stated application-record
  budget only if provider internals obey it; no constant database-time claim is
  supported. Measure rows at load/serialize boundaries and SQL plans in A7.
- **Minor / simplicity:** A persisted Task table is deferred consistently with the
  existing UX spec; a bounded virtual key union is a concrete smaller candidate.
  Seek/rank remains an alternative if the ORM composition spike fails. Revisit
  the architecture decision instead of adding another query framework implicitly.

## Grounding and exact source evidence

- `work-inbox/user-task-source.ts`: findAndCount uses offset+limit at zero.
- `work-inbox/service.ts`: collects result rows, canonical sorts, slices afterwards.
- Enterprise `lib/workInbox/agentDispositionSource.ts`: same prefix and presentation
  over all returned proposals.
- `work-inbox/provider.ts`: public list-only contract, optional-source selection,
  unchanged registration mechanism, comparator Infinity subtraction at absent due
  dates and no cross-source discriminator after equal ids.
- `api/openapi.ts:taskListDiagnosticsSchema`: candidate total intentionally counts
  hidden tasks; existing entityHiddenCount is marker-array length. The proposal
  preserves these value meanings and changes coverage explicitly.
- `lib/task-visibility-request.ts`: diagnosable principals lift the SQL entity gate,
  partitionTaskPage produces content-free markers and silently drops other denials.
- `api/work-inbox/route.ts`: hasMore currently uses visible result row count;
  `next/route.ts` consumes the same service before existing guarded claims.

## Validation and audit limits

Runner: **local**. Required compose probe order found no running app container:
fullapp.dev probe exited 0 with no id; fullapp probe exited 1 with no running app.
No node_modules exists in this worktree. No dependency install, migration, app,
worker, database or background process was started by this task.

A dependency-free Node source diagnostic (in cockpit Assets as
`8165-source-evidence.mjs` and `8165-source-evidence.tap`) executed the real comparator
using Node's type stripping and confirmed its NaN tie result; three additional
source-path checks confirmed both prefix requests and post-collection slicing.
**4/4 diagnostic checks passed, confirming current defects, not a fix.** No live
load test, DB query-plan, new regression suite, Jest or Playwright pass is claimed.
Markdown whitespace and local link/required-section checks are recorded in the
run evidence. Source diagnostic assets are not production tests shipped in this PR.

Per `om-auto-review-pr/references/spec-review.md`, the runtime configured commands
are inapplicable to this exclusively Markdown diff and are skipped: first
`yarn build:packages`, `yarn generate`, second `yarn build:packages`,
`yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`,
`yarn build:app`. No full configured gate is claimed. Future runtime work must run
all eight in order and the scoped API/UI integration suites.

Read root/core/workflows/enterprise/orchestrator guides, both relevant prior OSS
specs, enterprise process-model constraints, BC, spec template/review rules, QA
guide, and matching ordering/fixture-cleanup lessons. PostgreSQL documentation
supports SQL ordering/snapshot constraints; no third-party market comparison or
installed-ORM capability claim is substituted for the required spike. No new
library/dependency was fetched. No frontend architecture change is proposed.

Fresh-agent scope-cohesion/independent review was not run: the task explicitly
forbids further subtasks. GitHub self-approval must not be attempted. The draft
must remain pending for a maintainer/fresh reviewer, with no automerge or QA
approval. Runtime tests are required in the eventual implementation, not implied
by this design audit.

## Remediation plan

1. Before implementation: obtain named architecture, public-contract and legacy/
   diagnostic/order migration decisions; prove/freeze the provider transport and
   transaction behavior; update the spec and repeat readiness review.
2. During approved implementation: add the characterization commits, both adapters,
   bounded coordinator, and all A1–A10 self-contained unit/integration regressions.
3. Before rollout: integrate the proposed root release disclosure sequentially,
   run the configured gate and integration tests on the final head, obtain fresh
   review and required QA. Only then may a PR close #8165.
