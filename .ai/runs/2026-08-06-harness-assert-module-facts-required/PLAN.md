# Execution plan — assert the module facts the catalog only allows (#4603)

**Issue:** [#4603](https://github.com/open-mercato/open-mercato/issues/4603)
**Base:** `develop` @ `c95a715`
**Branch:** `cez/9e32deb5`
**Run folder:** `.ai/runs/2026-08-06-harness-assert-module-facts-required/`

## Tasks

| Phase | Step | Title | Exec | Status | Commit |
|---|---|---|---|---|---|
| 1 | 1.1 | Run folder: plan, baseline measurement, twelve-way decision table | inline | done | `24938c9b5` |
| 1 | 1.2 | Measure the per-case context footprint of the ten candidate cases | inline | done | `24938c9b5` |
| 2 | 2.1 | Add ten facts-owner routing cases and re-pin the catalog to 213 | inline | done | `46fc1a9ab` |
| 2 | 2.2 | Tighten the `module-facts-build` guard to "required by some case" with an explicit exemption list | inline | done | `50ba13cfd` |
| 3 | 3.1 | Record the closure in the #4602 audit doc (§1.4) and harness prose | inline | done | `f56d4841f` |
| 3 | 3.2 | Live-verify each new case on one runner and record the evidence | inline | done | `f56d4841f` |
| 3 | 3.3 | File the two out-of-scope follow-up issues and link them from #4603 | inline | done | #5057, #5058 |

## Goal

Close the weaker module-fact coverage tier: eleven shipped fact-sheets are referenced only through
`context.allowedExtra`, which permits a read but never fails a run that skips it. Decide, per module,
whether rebuilding the capability would be a meaningful regression; add a routing case with the sheet in
`context.required` for those where it would; record the reasoned exemptions for those where it would not.

## Non-goals

- Widening an existing case's `allowedExtra` — the anti-pattern #4603 explicitly rejects.
- Giving routing cases a case-local `timeoutMs` (writable-only by design; its own follow-up issue).
- Fixing OMH-169's `BACKWARD_COMPATIBILITY.md` guidance defect (its own follow-up issue).
- Re-tuning the budgets of the existing OMH-194…OMH-202 cohort.

## Baseline — measured on `develop` @ `c95a715`, not estimated

`packages/create-app/agentic/shared/ai/harness/cases.json` holds **203** cases, `OMH-001`…`OMH-203`.
All eleven sheets named by #4603 have **zero** occurrences in any `context.required`:

```
api_docs         required: -  | allowedExtra: OMH-011
audit_logs       required: -  | allowedExtra: OMH-077,OMH-126
business_rules   required: -  | allowedExtra: OMH-096
dashboards       required: -  | allowedExtra: OMH-008,OMH-087,OMH-089,OMH-136
directory        required: -  | allowedExtra: OMH-106
entities         required: -  | allowedExtra: OMH-024
inbox_ops        required: -  | allowedExtra: OMH-087,OMH-098
messages         required: -  | allowedExtra: OMH-087,OMH-097
onboarding       required: -  | allowedExtra: OMH-097
planner          required: -  | allowedExtra: OMH-098,OMH-100
translations     required: -  | allowedExtra: OMH-023,OMH-087,OMH-097
```

Target after this change: **zero** qualifying modules without a `context.required` reference.

### A twelfth module the issue does not name

Re-running the same predicate against the *shipped* set (the production `selectModuleFactSheets`
intersection on an emitted controller, 49 sheets) rather than against #4603's list finds **twelve**
sheets with no `context.required` reference, not eleven. The extra one is **`design_system`**, reached
only through OMH-014's `allowedExtra`. It post-dates the #4602 audit, which is why #4603 does not list
it. It is handled here because tightening the guard (Step 2.2) is impossible without accounting for it.

```
BEZ required PRZED: api_docs, audit_logs, business_rules, dashboards, design_system, directory,
                    entities, inbox_ops, messages, onboarding, planner, translations   (12)
BEZ required PO:    api_docs, design_system                                            (2)
```

## Step 1.1 — the twelve-way decision

The test applied to each module, all four conditions required for a case to be warranted:

- **(a) owns duplicable surface** — persistent schema or a contract an agent could re-create;
- **(b) plausible hand-roll** — a realistic app-building prompt where an agent would build its own;
- **(c) real regression** — hand-rolling loses tenancy, ACL, or cross-module integration;
- **(d) not already forced** — the correct answer is not already compelled by `AGENTS.md` or
  `.ai/guides/architecture.md`, so the fact-sheet read is genuinely load-bearing.

| Module | Tables owned | ACL features | Verdict | Reasoning |
|---|---|---|---|---|
| `api_docs` | none | none (`features: []`) | **no case** | See below — fails (a). |
| `audit_logs` | `action_logs`, `access_logs` | 6 (self/tenant view, undo, redo) | case | A bespoke audit trail is #4603's own example; loses undo/redo scaffolding and the self-vs-tenant read split. |
| `business_rules` | `business_rules`, `rule_execution_logs`, `rule_sets`, `rule_set_members` | 5 | case | "Configurable automation without a redeploy" invites a hand-rolled if/then engine; loses the execution log and rule-set composition. |
| `dashboards` | `dashboard_layouts`, `dashboard_role_widgets`, `dashboard_user_widgets` | 4 | case | "Role-aware admin homepage with KPI widgets" invites a bespoke layout table; loses module-provided widget contribution. |
| `directory` | `tenants`, `organizations` | 4 | case | "Branches / sites / departments" is the classic re-model of `organizations`; the module's own record surface is absent from `architecture.md`, so (d) holds even though tenancy rules are asserted broadly. |
| `entities` | 6 incl. `custom_field_defs`, `custom_entities`, `custom_field_values` | 4 | case | Hand-rolled EAV for "user-defined fields" loses the query-index hybrid path and the encryption map. |
| `inbox_ops` | 5 incl. `inbox_emails`, `inbox_proposals` | 5 | case | "Turn forwarded email into an approved action" is a distinctive capability; `ejectable: true` means start-from-and-replace, not rebuild-from-zero. |
| `messages` | 5 incl. `messages`, `message_recipients`, `message_confirmations` | 7 | case | "Internal notes with attachments and email forwarding" invites a bespoke thread table; loses access tokens and confirmations. |
| `onboarding` | `onboarding_requests` | 3 | case | #4603 names "a second onboarding flow" explicitly; a hand-rolled signup bypasses the verification feature. |
| `planner` | `planner_availability_rule_sets`, `planner_availability_rules` | 2 | case | "Staff working hours so bookings land in open slots" invites a private availability table; loses the shared rules other modules consume. |
| `translations` | `entity_translations` | 3 | case | Per-entity translation columns are the classic re-model; loses the locale overlay applied to CRUD responses. |
| `design_system` | none | 1 (`design_system.view`) | **no case** | See below — fails (a), same class as `api_docs`. |

### The two exemptions: `api_docs` and `design_system`

Both get **no case**, and this is a decision rather than an omission. Both fail condition (a) outright:
neither ships a `data/` directory, an entity, or a migration.

`api_docs` exports `features: []` — literally no access-control surface. Its whole module is
`lib/resources.ts` (a static link list), a backend page, a frontend OpenAPI explorer, and a `GET`
version endpoint, all derived from route registration that already happened elsewhere.

`design_system` is an in-app component gallery (`backend/`, `gallery/`, `setup.ts`) with the single
view-only feature `design_system.view`.

In both cases there is no schema an agent could duplicate and no access-control posture it could get
wrong, so three of the four decisions this cohort asserts (`facts-first`, `tenant-scope`,
`acl-features`) have nothing to bind to. An agent that renders its own endpoint list or its own
component gallery duplicates a view, not a capability contract, and that is not a regression worth
failing a run over. Their existing `allowedExtra` references (OMH-011 and OMH-014) stay: both sheets
remain offerable, just not asserted. The guard in Step 2.2 enforces exactly that — an exemption must
still be shipped and still be routed, so the list cannot rot into a hidden coverage hole.

## Step 1.2 — budget calibration, measured per case

Measured on a real emitted controller (`node packages/cli/dist/bin.js agentic:init --tool claude-code`
in an empty root holding the template's `src/modules.ts`), the same surface the #4602 audit used. The
staged unit-test fixture measures fact-sheets as zero bytes, so it cannot calibrate the total-byte arm.

The evaluator counts a path toward the *initial* budgets unless it lives under `/references/`,
`.ai/framework-context/`, `.ai/guides/modules/`, `.ai/guides/upstream/`, or `.agents/skills/`, so each
case's own fact-sheet counts toward `maxTotalContextBytes` only. Every case requires the same three
initial files — `AGENTS.md` (11 814 B), `.ai/guides/architecture.md` (7 154 B),
`.ai/skills/om-help/SKILL.md` (1 817 B) = **20 785 B over 3 files** — and differs in its declared
extras, which is what makes the budgets differ.

Calibration rule, applied identically to all ten and rounded to the 4 KiB grid:

- `maxContextFiles` = declared initial files **+ 2** (one incidental read, one margin);
- `maxInitialContextBytes` = declared initial bytes **+ ≥4 KiB**, rounded up;
- `maxTotalContextBytes` = declared total bytes **+ ≥8 KiB**, rounded up.

| Case | Module | req initial (files/B) | declared initial (files/B) | declared total B | `maxContextFiles` | `maxInitialContextBytes` | `maxTotalContextBytes` |
|---|---|---|---|---|---|---|---|
| OMH-204 | `audit_logs` | 3 / 20 785 | 6 / 46 198 | 63 647 | 8 | 53 248 | 73 728 |
| OMH-205 | `business_rules` | 3 / 20 785 | 6 / 46 198 | 75 100 | 8 | 53 248 | 86 016 |
| OMH-206 | `dashboards` | 3 / 20 785 | 6 / 45 175 | 85 580 | 8 | 53 248 | 94 208 |
| OMH-207 | `directory` | 3 / 20 785 | 5 / 33 893 | 60 166 | 7 | 40 960 | 69 632 |
| OMH-208 | `entities` | 3 / 28 870 | 7 / 49 825 | 90 729 | 9 | 57 344 | 106 496 |
| OMH-209 | `inbox_ops` | 3 / 20 785 | 5 / 36 846 | 82 479 | 7 | 40 960 | 94 208 |
| OMH-210 | `messages` | 3 / 20 785 | 4 / 29 142 | 109 091 | 6 | 36 864 | 118 784 |
| OMH-211 | `onboarding` | 2 / 18 968 | 3 / 27 326 | 51 978 | 5 | 32 768 | 61 440 |
| OMH-212 | `planner` | 2 / 18 968 | 5 / 34 050 | 48 173 | 7 | 40 960 | 77 824 |
| OMH-213 | `translations` | 3 / 20 785 | 5 / 41 447 | 53 944 | 7 | 49 152 | 65 536 |

Global ceilings are untouched and none is approached: `maxContextFiles` 16, `maxInitialContextBytes`
98 304, `maxTotalContextBytes` 262 144.

Two calibration consequences worth recording:

- These budgets are **not** the OMH-194…OMH-202 envelope (a uniform 11 / 57 344 / 147 456 the #4602
  audit itself called "generous rather than tight"). Copying it is the mistake #4603 asks to avoid.
- Declaring a large neighbouring fact-sheet as `allowedExtra` inflates the total budget for little
  gain and weakens the assertion, so extras stay on conceptual guides, skills, and small related
  sheets. An early draft declaring `.ai/guides/modules/customers.md` (216 249 B) pushed three cases
  past the 262 144 B global ceiling; that is a measurement result, not a style preference.

### Three cases recalibrated from live evidence

The declared-set calibration above was the starting point; three cases were then corrected against
what live routing actually did, which is the stronger measurement. This is the same move the #4602
audit made for OMH-199/200/201 (§3.2) — align the assertion with what correct routing selects, and
keep the fact-sheet in `context.required`, which is the part that fails when an agent hand-rolls the
capability.

- **OMH-208 `entities`** routed to `umes`, not `architecture`, and opened `om-system-extension`
  rather than `om-help`. For a "custom fields and record types" prompt that is the *correct* domain —
  `architecture` was the guess. Its required context now names the `umes` route's own standard guide
  and skill, and its budgets come from the live footprint.
- **OMH-211 `onboarding`** produced the right route, the fact-sheet read, and all four decisions with
  **no skill opened at all**. Requiring `om-help` asserted process rather than outcome, so neither the
  skill nor its `SKILL.md` is required any more.
- **OMH-212 `planner`** was the only case that never read its own fact-sheet: it routed to
  "scaffold a new module" instead of "reuse the installed one". That is the prompt failing at its one
  job, so the prompt now demands the installed owner be named *before* any schema is proposed. It
  reads `planner.md` on the re-run.

`requiredSkills` is empty on these three rather than naming a skill: every skill live routing did
select is already the standard skill of a route the case permits (`ROUTE_STANDARD_CONTEXT`), so it is
allowed without being asserted. An `optionalSkills` entry cannot express this — the evaluator requires
an optional skill's route to be an `allowedExtra` route, never a required one.

### Metadata caveat

Live measurement adds directory-listing metadata to `initialFiles`/`initialBytes` (evaluator
`contextStats`, `metadata.entries`). A single listing of `.ai/guides/modules/` (49 entries) would
exceed any per-case file budget. This is a pre-existing property of every routing case in the catalog,
not something these budgets can absorb, and it is recorded rather than worked around.

## Step 2.2 — the guard decision

`packages/create-app/src/lib/module-facts-build.test.ts:139` currently passes when a shipped sheet is
*routed* by any case, counting an `allowedExtra` reference. The comment above it already names #4603 as
the owner of tightening it. This run tightens it to **required by at least one case**, carrying a single
explicit exemption — `api_docs` — with the reason recorded in the test itself. That keeps the guard
honest for every future module (enabling one in the template without an asserting case is a red test)
while recording the one deliberate gap rather than hiding it behind the weaker predicate.

## Risks

- Adding ten cases moves the catalog from 203 to 213 and must update **six** pinned locations
  atomically; an intermediate commit with an inconsistent pin fails the deterministic gate, so the case
  addition and the re-pin are deliberately one Step and one commit.
- `relatedCases` in `cases.schema.json` already trails the catalog by one (`20[0-2]` against `OMH-203`);
  it is realigned here.
- Live routing is model-variance-prone; §3.2 of the #4602 audit records prior cases needing a
  `requiredSkills` retarget after the first live run. The same may happen here.

## Handoff & notifications

- `HANDOFF.md` — rewritten at each checkpoint and at run end.
- `NOTIFY.md` — append-only UTC log.
