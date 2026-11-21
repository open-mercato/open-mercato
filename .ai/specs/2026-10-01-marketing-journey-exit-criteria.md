# Marketing Journey Exit Criteria

| Field | Value |
|-------|-------|
| **Status** | Specification (rev 1) |
| **Created** | 2026-10-01 |
| **Modules** | `marketing_automation` (`packages/marketing-automation`) |
| **Depends on** | Nothing new. Reuses the `business_rules` condition tree, the subject document, the audience field catalog and the existing resume path. |
| **Related** | [Cart Module](./2026-08-14-cart-module.md) — the abandoned-cart trigger this unblocks on the marketing side; the marketing-automation module spec, in this PR |
| **Migration** | None. See § Migration & Backward Compatibility. |

---

## TLDR

**Key Points:**
- Nothing can stop a journey once its purpose has been served. A three-message recovery sequence sends
  message two and message three to somebody who already bought, because nothing between the steps asks
  whether the reason for the sequence still holds.
- One authored condition per campaign — "stop when this becomes true" — in the **same** `business_rules`
  condition tree the audience already uses, over the **same** subject document, evaluated at the **start of
  every executor pass**. No new DSL, no new builder, no second evaluator.
- The exit expression gets a field group the audience does not have: `since.*`, counted from the run's own
  `startedAt`. "Stop when they order" is `since.orders.count >= 1` — a question the absolute subject document
  cannot ask.
- **One insertion point.** Both the dispatch pass and the resume pass end in `persist()` in
  `lib/dispatcher.ts`; the check goes there, and the subject document is built lazily only when the campaign
  actually has an exit condition. Campaigns without one pay nothing.
- **Fails open, loudly.** The audience fails closed because its failure mode is "send nothing to this one
  subject". An exit condition's failure mode is "stop every subject in every campaign", so a throwing
  expression degrades to *guard absent* and reports the error.
- No migration. `definition` is one jsonb column, so the condition is an optional fifth key; `status` is a
  plain `text` column with no check constraint, so `exited` costs nothing in the database.

**Scope:**
- `CampaignDefinition.exit` — an optional condition, saved through the existing graph-save endpoint
- The `since.*` run-relative field group, available in the exit expression only
- Evaluation at the start of every executor pass, before the step the run parked at
- A terminal `exited` run status, an `exit` gate in the delivery explanation, and the reporting that makes
  both legible
- Authoring UI on the campaign page, reusing `AudienceBuilder` unchanged
- Integration coverage: graph-save, the resume path, the runs list, the explanation screen, the results screen

**Non-goals:**
- **Per-step exit conditions.** One condition per campaign; `definition.exit` can gain a per-step sibling
  later, purely additively, if a real case appears.
- **A platform-wide trigger primitive.** `workflows` and `business_rules` have the same gap, and `workflows`
  can hand-build the check from a condition step and a signal. One working temporal implementation and one
  asking consumer is not enough evidence to design a contract for three engines. This spec is the prior art
  to lift if that changes.
- **The cart module.** Abandoned-cart recovery needs a cart; that is
  [its own spec](./2026-08-14-cart-module.md). This spec is what makes the recovery sequence correct once
  the cart exists, and is independently useful before it does.

---

## Overview

The module's journey engine is careful about stopping. `lib/engine/executor.ts` distinguishes two kinds with
a comment explaining why they are opposite: a `wait` step has finished its job so the run resumes *after* it,
while quiet hours have not let the message out so the run resumes *at* it.

There is a third kind it has no concept of: the reason for the whole sequence has gone away.

`lib/dispatcher.ts` already contains one hand-rolled instance of exactly that check. `resumeRun` asks whether
the campaign is still enabled, with the comment:

> Disabling a campaign is expected to stop it, including for customers already parked inside it. Without this
> check a disabled campaign keeps delivering to everybody mid-journey.

That is this feature, for one hardcoded condition, written at the one correct moment. This spec generalises
the condition and leaves the moment where it already is.

---

## Problem Statement

### What is missing

The gates in `lib/engine/gates.ts` are about permission and timing: channel suppression, the recipient's own
pause and cap, the campaign's frequency cap, quiet hours, send hour. Every one asks *may we send this now?*
None asks *should we still be sending this at all?*

`grep -rni 'exitCriteria|goal|unenrol' lib/engine/ data/` returns nothing.

### Who it bites today, with no new module

This is not blocked behind the cart. The module ships `expiring_quotes` as a sweep source, and a quote
follow-up is its natural use: remind at 7 days, again at 3, again at 1. Accept the quote after the first
reminder and the second and third still arrive. `reorder_due` has the same shape — reorder after the nudge
and the nudge repeats. Both ship. Both are wrong today.

### Why the step vocabulary cannot work around it

A journey's steps are a fixed set: `wait`, `split`, `add_tag`, `add_points`, `send_email`, `nps_survey`,
`issue_referral_code`, `assign_owner`, `notify`, `send_signal`. None reads live state, and none can terminate
a run. `registerMarketingSteps` lets another module add a step type, but a third-party step that silently
ends somebody's journey is a worse contract than a declared condition on the campaign.

---

## Proposed Solution

### The condition

`CampaignDefinition` gains an optional `exit`:

```ts
// data/validators.ts
export const campaignDefinitionSchema = z.object({
  version: z.literal(1),
  audience: audienceSchema.default(null),
  exit: audienceSchema.default(null),   // same shape, same builder, same evaluator
  steps: z.array(campaignStepSchema).default([]),
  canvas: campaignCanvasSchema.optional(),
})
```

`version` stays `1`. The key is optional and absent means off, so every definition already stored keeps
parsing and keeps meaning what it meant.

**Deliberately a separate expression, not "re-evaluate the audience."** Re-evaluating looks free and is a
trap: entry-only audiences ("created an account in the last 24 hours") stop being true by construction, so
every journey built on one would exit on its first resume. Entry and exit are different questions that happen
to share a language.

### The `since.*` field group

The subject document is absolute — `orders.count`, `orders.daysSinceLast`, `orders.totalGross`. None of it
can express "ordered **since this journey started**", which is the condition almost every exit wants.

So the exit expression — and only the exit expression — sees one extra group, computed from the run's own
`startedAt`:

| Path | Meaning |
|------|---------|
| `since.orders.count` | Orders placed after the run started, under the same `PLACED_ORDER_FILTER_SQL` the rest of the module counts by |
| `since.orders.totalGross` | Their gross total |
| `since.days` | Whole days the subject has been in this journey — lets an author cap a journey's lifetime |

Zero is a correct and meaningful value for all three, so unlike `orders.daysSinceLast` these are plain
numbers rather than absent-when-unknown. The discipline at `lib/engine/types.ts:74` (*"ABSENT — not null"*)
applies to magnitude-of-a-missing-thing fields and is not weakened here: a window count of zero is a count,
not a missing value.

"Stop when they order" is then `since.orders.count >= 1`. "Give up after a fortnight" is
`since.days >= 14` — a lifetime cap, not a goal, which is why the reporting copy below cannot say "goal".
`since.orders.totalGross >= 200` is the B2B shape of the same question: a quote follow-up whose point is
recovered revenue should stop at the threshold that counts as recovered, not at the first small reorder.

**Cost, stated honestly.** `loadSinceAggregate` is `ORDER_AGGREGATE_SQL` with `and placed_at > ?`, and
`sales_orders` carries `sales_orders_customer_idx` on `(customerEntityId, organizationId, tenantId)` with no
`placed_at` member — so the timestamp is a filter over that index's rows, not a seek. This is the same scan
the enrolment-time subject document already performs for every subject, so the per-build cost is one the
module already pays; what is new is *how often* it is paid. Risk #3 covers the frequency, and Phase 1 step 7
measures the build.

### Where it is evaluated

At the start of every executor pass, before the step the run parked at.

Within a single pass no time passes — the steps run at one instant, so re-asking between them returns the
same answer. Every moment the world can change is a pass boundary, and there are exactly two kinds:

- the **dispatch** pass that follows enrolment — the condition can already be satisfied between the
  triggering event and the worker claiming the job. Seconds, but a quote accepted in the minute after it was
  flagged as expiring is exactly that window, and
- every **resume** pass, whether enqueued when the wait parked the run or found later by the due-run scan.

`startCampaignForSubject` and `resumeRun` both finish by calling
`persist(deps, run, claimToken, steps, policy, state)`, and **`persist` wraps execution rather than
following it** — `executeRun` is called from inside it, and `persist` owns the transition that follows. So
the check sits at the top of `persist`, before its `executeRun` call, and covers both passes from one place.
`persist` gains the expression as a seventh argument, symmetric with `steps` and `policy`, which already come
from the same definition.

One call site. One subject document build per pass, and only when `definition.exit` is non-null, so an
unconfigured campaign's cost is one null check.

### What it produces

A terminal `exited` status, plus a `stepLog` entry naming where the run was standing when it left — the same
shape the disabled-campaign path already appends.

---

## Architecture

### New files

| File | Responsibility |
|------|----------------|
| `lib/engine/exit.ts` | `shouldExit(subject, expression, logger): boolean` — pure, over a subject document extended with `since`. Wraps `matchesAudience`'s evaluator; owns the fail-open decision. |
| `lib/engine/__tests__/exit.test.ts` | Unit coverage, including the throwing expression and the entry-only trap. |

### Changed files

| File | Change |
|------|--------|
| `data/validators.ts` | `exit` key on `campaignDefinitionSchema`; `exitFieldCatalog` guard so only `since.*` plus the audience catalog are accepted |
| `lib/engine/types.ts` | `SubjectDocument` gains an optional `since` group |
| `lib/engine/executor.ts` | `RunTransition` gains `{ kind: 'exited'; stepLog; context; reason }`. **The executor never returns it** — the variant exists so the dispatcher can hand it to `applyTransition`, and the executor stays unaware of exit entirely. |
| `lib/runs.ts` | `applyTransition` handles `exited`: terminal, `completedAt` set, `resumeAt`/`claimToken`/`claimedAt` cleared. See § Data Models on what `completedAt` means for an exited run. |
| `lib/subject-document.ts` | `loadSinceAggregate(em, subjectEntityId, since, scope)` — one aggregate, `ORDER_AGGREGATE_SQL` with `and placed_at > ?` |
| `lib/dispatcher.ts` | `persist()` takes the exit expression; evaluates before `executeRun`; `startCampaignForSubject` and `resumeRun` pass `definition.exit` |
| `lib/engine/explain.ts` | An `exit` `GateVerdict`, `outcome: 'drop'`, decisive when it matched |
| `lib/audience/field-catalog.ts` | The `since` group, flagged so the audience panel does not offer it |
| `api/campaigns/[id]/runs/route.ts` | `RUN_STATUSES` gains `'exited'` |
| `data/entities.ts` | `MarketingCampaignRun.status` union gains `'exited'` |
| `backend/marketing/campaigns/[id]/page.tsx` | A second `AudienceBuilder` panel |
| `i18n/*.json` | Panel copy, the status chip, the explanation row, the results counter |

### Fail-open, and why it is the opposite of the audience

`lib/engine/audience.ts` documents `AUDIENCE_ERROR_RESULT = false` as fail-closed, with the right reasoning:
*"the safe failure for a bug in a sending system is to send nothing."*

The exit condition inverts the blast radius. A throwing exit expression that fails closed would exit every
run it is evaluated for — the campaign goes silently dead across every subject, which is a far worse outcome
than the bug this feature fixes. So:

```ts
export const EXIT_ERROR_RESULT = false   // "do not exit" — the guard is absent, not triggered
```

A new optional guard that breaks must degrade to *absent*, not to *total halt*. Every such failure calls
`reportError` with `code: 'marketing_automation.exit_evaluation_failed'` and logs the campaign and run id, so
"silently absent" is only silent in the sending path, never in telemetry.

### Sequence

```
dispatch / resume pass
  claimRun
  campaign still enabled?            ── no ──> completed ("campaign disabled or removed")   [existing]
  definition.exit set?               ── no ──> executeRun                                  [unchanged cost]
  build subject document + since
  shouldExit?                        ── yes ─> applyTransition({ kind: 'exited' })          [new]
  executeRun
```

---

## Data Models

**No migration.** Both changes are to columns whose storage already accepts them:

- `marketing_campaigns.definition` is `jsonb` holding `{ version, audience, steps, canvas }` — the module
  chose one column over child tables precisely so the authored graph could grow. `exit` is a fifth key.
- `marketing_campaign_runs.status` is `@Property({ type: 'text', default: 'running' })` with a TypeScript
  union and **no check constraint** (verified across the module's migrations). `'exited'` is a new union
  member and nothing else.
- The partial unique index `marketing_runs_active_subject_uniq` covers
  `status in ('running','waiting','claimed')`. `exited` is terminal and outside that set, so the index is
  correct unchanged — an exited run does not hold the subject.

```ts
status!: 'running' | 'waiting' | 'claimed' | 'completed' | 'failed' | 'dead' | 'exited'
```

### `completedAt` on an exited run

An exited run gets `completedAt` set, which makes the column mean *reached a terminal state* rather than
*finished its steps*. That is a widening, so it was checked rather than assumed: the three places that read
it — `lib/gdpr.ts`, `api/customers/[id]/profile/route.ts` and `api/campaigns/[id]/runs/route.ts` — all
surface it **beside** `status`, and none treats a non-null `completedAt` as a synonym for completion. No
query filters on it.

The alternative, a second terminal timestamp, would add a column to express what `status` already says and
leave two timestamps to keep consistent. Any new reader must therefore key the distinction on `status`, never
on `completedAt` — recorded here because it is the kind of thing a later query gets wrong silently.

### Re-entry

`exited` frees the subject at the index level immediately. Re-enrolment stays governed by what already
governs it: `reentryAfterDays` on a schedule trigger, and the occurrence-dedup window released by
`expireOccurrenceKeys` for event triggers. Neither is touched.

That is the decision, not an accident: those settings are already the merchant's answer to *how often may
this campaign touch one person*, and an exit is not a reason to override what they chose. A new cart
therefore starts a new journey only once the campaign's own window allows it.

---

## API Contracts

All four changes are additive. No request shape becomes stricter and no response field is removed.

### `PUT /api/marketing_automation/campaigns/[id]/save-graph`

`definition` accepts an optional `exit` condition tree, identical in shape to `audience`. Absent is
preserved as absent — a client that does not know about the key round-trips a definition unchanged.

Guarded by `marketing_automation.campaigns.manage`, unchanged. The optimistic lock on `updatedAt` is
unchanged. Authoring an exit condition is **not** publishing, so it stays on `manage` rather than
`campaigns.publish`.

### `GET /api/marketing_automation/campaigns/[id]/runs`

- `status` response values may now include `'exited'`
- the `status` query filter accepts `'exited'` (`RUN_STATUSES`)

**This is the one place a consumer could be switching on an enum**, so it is recorded in
`BACKWARD_COMPATIBILITY.md` as an additive enum value and in `UPGRADE_NOTES.md`.

### `GET /api/marketing_automation/campaigns/[id]/explain`

`gates[]` may contain `{ gate: 'exit', outcome: 'drop', decisive: true, detail: { matchedAt, stepId } }`.
The screen already renders an unknown gate row from its key, so this answers *"why didn't this customer get
it?"* with *"they left the journey — the stop condition matched"* rather than showing six passing gates and
no reason.

### `GET /api/marketing_automation/campaigns/[id]/tracking`

The results payload gains `stoppedEarly: number` — runs in `exited` for this campaign.

Per the Q2 decision it is **reported beside the funnel and credits no revenue**. Attribution stays
event-driven and untouched, so the module keeps exactly one definition of a conversion.

The label is specified, because it is the only control against misreading it, and it must stay neutral about
*why* a run stopped: a `since.days >= 14` cap and a `since.orders.count >= 1` goal both land in this one
number, so copy like "the goal was met" would mislabel every campaign using a cap. The label is
**"stopped early"**, with the campaign's own exit condition shown beside it so a merchant reads the count
against the rule that produced it. It is never rendered as money.

---

## Authoring UI

The campaign page (`backend/marketing/campaigns/[id]/page.tsx`) already renders `AudienceBuilder` with
`{ value, onChange, fields, options }`. The exit panel is a second instance of the same component with the
`since`-extended field list — no new component, no new condition language, and the DS primitives already in
use on that page.

Three things the panel must do beyond rendering:

1. **Offer `since.*` first.** It is the group that makes the feature work, and an author reaching for
   `orders.count` instead will write something true at enrolment.
2. **Warn when the condition already matches the preview subject.** The entry-only trap is the predictable
   authoring mistake, and the module already has a preview subject and an audience-estimate endpoint to ask
   with. A condition true on day zero is almost certainly wrong, and the panel should say so before publish
   rather than after a campaign quietly sends nothing.

   **What this warning can and cannot catch.** A preview subject has no run, so `since.*` evaluates as zero
   for it — a `since.orders.count >= 1` condition can never trip the warning, and should not, because it is
   correct. The warning therefore catches exactly the absolute-field conditions that are the named trap, and
   nothing else. That is the whole of its reach and the panel's copy must not imply more.
3. **State what saving will do to journeys already in flight.** A condition added to a live campaign is
   evaluated against every parked run on its next resume, which can end an in-flight sequence for many
   people at once. The save confirmation counts the waiting runs it will next be evaluated against, in the
   same shape as the module's existing pre-publish volume question ("the next scheduled pass will start this
   journey for at most 6 people"). This is the mitigation risk #6 rests on.

Copy, the status chip and the explanation row go through `i18n/*.json` under
`marketing_automation.exit.*`. No hardcoded strings; status colours use
`{property}-status-{status}-{role}` tokens per `.ai/ds-rules.md`.

---

## Phasing

**The three phases are implementation sequence inside one change, not three releases.** Each phase boundary
is a reviewable working state; the change is not done until Phase 3, which is what lets § Integration
Coverage require the specs in the same change. **Phase 1 is the MVP** — if the change has to be cut short,
Phase 1 alone is coherent and shippable, and Phases 2–3 become the follow-up.

### Phase 1 — Engine and persistence

1. `lib/engine/exit.ts` with `shouldExit` and `EXIT_ERROR_RESULT`; unit tests including the throwing
   expression and an entry-only condition
2. `since` on `SubjectDocument`; `loadSinceAggregate` in `lib/subject-document.ts`; `since` group in the
   field catalog, flagged out of the audience panel
3. `exited` on the `RunTransition` union and in `applyTransition`; `exited` on the entity status union
4. `persist()` takes the expression and evaluates it; both callers pass `definition.exit`
5. `exit` key on `campaignDefinitionSchema`
6. `'exited'` in `RUN_STATUSES` on `api/campaigns/[id]/runs/route.ts`, **in this phase, not Phase 3** — the
   moment step 3 can write the status, the runs route must accept it as a value and as a filter, or the list
   rejects a status its own table holds
7. Measure one `loadSinceAggregate` against a realistic order volume and record it here (see risk #3) — the
   cost ships in this phase, so the measurement belongs in it

Deployable: an exit condition set through the API stops runs correctly, and every read surface tolerates the
new status. No authoring UI yet.

### Phase 2 — Authoring

8. The exit panel on the campaign page, reusing `AudienceBuilder`
9. The already-matches warning, over the existing preview subject
10. The save confirmation stating how many waiting runs the condition will next be evaluated against — the
    mitigation risk #6 depends on, so it is a step rather than a sentence
11. i18n for every string

Deployable: merchants can author the condition and are told what saving it will do to journeys already in
flight.

### Phase 3 — Reporting

12. The `exited` status chip in the runs list
13. The `exit` gate in `explainDelivery` and on the explanation screen
14. `stoppedEarly` in the tracking payload and on the results screen

Deployable: the feature is answerable for.

---

## Integration Coverage

Required in the same change, per `.ai/qa/AGENTS.md`. Self-contained: fixtures created in setup through the
API, records cleaned up in teardown, no reliance on seeded data.

| Spec | Covers |
|------|--------|
| `TC-MA-050-journey-exit-criteria.spec.ts` | Save an exit condition through `save-graph`; enrol a subject; satisfy `since.orders.count >= 1`; resume; assert the run is `exited`, that the second send never happened, and that the `stepLog` names the step it stopped at. Plus: a throwing condition leaves the run running (fail-open), and an unconfigured campaign is byte-identical in behaviour. |
| `TC-MA-051-exit-reporting-ui.spec.ts` | The runs list shows and filters the `exited` chip; the explanation screen names the exit gate as decisive; the results screen shows `stoppedEarly`. |
| `TC-MA-002-save-graph.spec.ts` (extend) | The new optional key round-trips, and a definition without it is preserved without it. |
| `TC-MA-037-explain-delivery.spec.ts` (extend) | The new gate appears only for exited runs. |
| `TC-MA-048-organization-isolation.spec.ts` (extend) | `since.orders.*` aggregates never cross an organization. |

---

## Risks & Impact Review

| # | Failure scenario | Severity | Area | Mitigation | Residual |
|---|------------------|----------|------|------------|----------|
| 1 | A malformed exit expression throws and every journey in every campaign terminates | **High** | Sending | `EXIT_ERROR_RESULT = false` — fail open to *guard absent*. Reported **once per campaign per pass batch**, not once per run: a broken expression throws for every run it touches, so an unthrottled `reportError` would bury the signal it is meant to raise | Telemetry is the only signal, and it is the one the mitigation names. `stoppedEarly` is explicitly **not** a detector — zero is indistinguishable from a healthy campaign whose condition has not matched yet, and it does not exist until Phase 3 while the fail-open path ships in Phase 1. |
| 2 | An author writes a condition true at enrolment (entry-only audience fields) and the campaign sends nothing | **Medium** | Authoring | `since.*` offered first; the panel warns when the condition already matches the preview subject | An author can dismiss the warning. The results counter then shows every run exiting at step zero, which reads as the symptom it is. |
| 3 | A subject document build per resume on a high-volume campaign | **Medium** | Performance | Built only when `exit` is configured; one build per **pass**, not per step; the sweep's existing per-tick ceilings bound the batch. One build costs what an enrolment-time build already costs (§ The `since.*` field group), and Phase 1 step 7 measures it against a realistic order volume before the authoring UI invites the load | A campaign with a long wait chain and six figures of runs adds one build per run per wait, and the frequency is the exposure. There is **no runtime throttle and no opt-out short of removing the condition** — if the Phase 1 measurement is bad, the answer is a design change (cache the aggregate for the pass batch) inside this change, not a flag. |
| 4 | A consumer switching on run status breaks on `exited` | **Medium** | Contract | Additive enum value, recorded in `BACKWARD_COMPATIBILITY.md` and `UPGRADE_NOTES.md`; `RUN_STATUSES` accepts it as a filter | A third-party client with an exhaustive switch sees an unhandled value. Unavoidable for any new terminal state; the alternative (reusing `completed`) destroys the distinction the feature exists to report. |
| 5 | `stoppedEarly` is read as a revenue number and double-counts against attribution | **Medium** | Reporting | Q2 decision: the exit credits nothing; attribution stays event-driven and untouched; the label states what the count is | Merchants may still conflate them. Copy is the only control, so the copy is specified rather than left to the implementer. |
| 6 | Adding a condition to a live campaign retro-applies to runs already parked inside it | **Low** | Behaviour | Intended — the same semantics as disabling a campaign, which already stops parked runs. Made deliberate by the save confirmation specified in § Authoring UI and delivered as Phase 2 step 10, counting the waiting runs the condition will next be evaluated against | A merchant can stop an in-flight sequence with one save. That is the feature; the confirmation is what makes it a decision rather than a surprise. |
| 7 | `since.orders.*` leaks across tenants or organizations | **High** | Security | The aggregate carries both scope columns, matching every other query in the module; covered by an extension to `TC-MA-048` | None beyond the module's existing scoping discipline. |

---

## Migration & Backward Compatibility

**No database migration.** `definition` is `jsonb` and `status` is `text` with no check constraint, both
verified against the module's migrations. No `.snapshot-open-mercato.json` change.

Against the 13 contract surfaces in `BACKWARD_COMPATIBILITY.md`:

| Surface | Impact |
|---------|--------|
| Types | `SubjectDocument` gains an **optional** `since`; `RunTransition` gains a variant; the run status union gains a member. Additive. |
| Signatures | `persist()` is module-private. `shouldExit` is new. `applyTransition` handles one more variant of a type it already accepts. No exported signature changes. |
| API routes | Four additive changes (§ API Contracts). No route added or removed. |
| DB schema | None. |
| Event IDs | None. No new event. An exit is a run-state change, not a domain event — if a subscriber ever needs one, that is additive and out of scope here. |
| ACL features | None. Authoring stays on `campaigns.manage`. |
| Generated files | None. |

Nothing is deprecated, so the deprecation protocol does not apply. `definition.version` stays `1`: the key
is optional and its absence is the previous behaviour exactly.

**Forward note.** If `workflows` later wants the same guard, the lift is `shouldExit` plus the pass-boundary
rule, not this module's data model. Recorded here so the second implementation starts from the argument
rather than rediscovering it.

---

## Final Compliance Report

| Rule | Status |
|------|--------|
| No cross-module ORM relationships | PASS — `since.orders.*` reads `sales_orders` through the module's existing raw aggregate, by FK id, as `subject-document.ts` already does |
| `organization_id` / `tenant_id` on every scoped query | PASS — the new aggregate carries both; `TC-MA-048` extended |
| Zod validation for all API inputs | PASS — `exit` on `campaignDefinitionSchema`, reusing `audienceSchema` |
| No `any`; types from `z.infer` | PASS |
| Encryption maps for sensitive columns | N/A — no new column, and the aggregate reads order money, not PII |
| Canonical primitives | PASS — existing `save-graph` command path, `AudienceBuilder`, `apiCall` on the pages already using it |
| Optimistic locking | PASS — unchanged; the condition saves through `save-graph`, which already carries `updatedAt` |
| Design System tokens | PASS — status chip uses `{property}-status-{status}-{role}`; no arbitrary values; no `dark:` on status tokens |
| i18n, no hardcoded strings | PASS — `marketing_automation.exit.*` |
| Structured logging + `reportError` in every recording catch | PASS — the fail-open catch reports |
| Singular naming | PASS — `exit`, `since`, `exited` |
| Integration coverage in the same change | PASS — § Integration Coverage |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-10-01 | Spec created. Open Questions gate resolved: journey-level condition only; `exited` is its own terminus crediting no revenue; re-entry keeps respecting the existing window. |
| 2026-10-01 | Rev 1 after fresh-context review (below): `persist` described as wrapping execution rather than following it; `RUN_STATUSES` moved into Phase 1; the save confirmation promoted from a risk sentence to Phase 2 step 10; `stoppedEarly` copy made neutral between a goal and a lifetime cap; the irrelevant `mkt_runs_subject_window_idx` citation replaced with the real cost basis; `completedAt` semantics for an exited run documented against its three readers; risk #1's residual corrected (telemetry, not the counter) and `reportError` throttled per campaign per pass batch; `since.*` behaviour for a preview subject stated; Phase 1 labelled MVP and the phases declared one change. |

### Review — 2026-10-01
- **Reviewer**: Agent (fresh context, spec file only — checklist §1 plus adversarial self-consistency)
- **Scope cohesion**: KEEP AS ONE — every surface is downstream of a single decision point; no bundle signals
- **Security**: Passed
- **Performance**: Needs revision → addressed (risk #3 rewritten; the measurement moved into Phase 1 and the absence of a runtime opt-out stated)
- **Cache**: N/A — no cached read introduced; a per-pass-batch aggregate cache is named as the remedy if the Phase 1 measurement is bad
- **Commands**: Passed — authoring rides the existing `save-graph` path, unchanged
- **Risks**: Needs revision → addressed (risks #1, #3 and #6 had mitigations that were unobservable, unquantified or absent from the architecture)
- **Verdict**: Approved after rev 1
