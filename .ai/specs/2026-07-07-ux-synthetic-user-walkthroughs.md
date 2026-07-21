# Synthetic User Walkthroughs — Persona-Driven UX Friction Reports on PRs

## TLDR

Add a new QA skill, `om-ux-walkthrough`, that takes a **persona** (a versioned markdown definition under `.ai/qa/personas/`) and a **task goal in natural language** ("create an invoice for client X and send it"), boots the PR's UI in the existing ephemeral integration environment, and *attempts the task the way that user would* — reading only visible labels, navigating goal-driven with no selector scripts and no source-code access during navigation. The run produces quantified **friction metrics** (steps vs. baseline, backtracks, dead ends, mislabels, abandoned goals, hesitation markers) and posts a sticky, advisory-only PR comment with a severity-rated friction table, annotated screenshots, and persona narration excerpts. A `--compare <runId>` mode verifies that a fix actually removed previously reported friction. The skill is a sibling of `om-auto-verify-pr-ui` and reuses its ephemeral-env, worktree, lock, and evidence-branch machinery wholesale. It never blocks merge and never touches pipeline labels: it moves usability signal from quarterly research into the PR loop, honestly framed as hypotheses rather than proof.

## Overview

- **Track:** QA/DX tooling (sibling of `om-auto-verify-pr-ui`; shares `.ai/qa/` infrastructure)
- **Branch:** `spec/ds-dx-developer-experience` (spec only; implementation lands on a feature branch)
- **New content:** `.ai/skills/om-ux-walkthrough/SKILL.md` (the skill), `.ai/qa/personas/*.md` (persona library with 2 seed personas), `.ai/qa/personas/AGENTS.md` (authoring rules), one new GitHub label `needs-ux-walkthrough`
- **Touched:** `.ai/qa/AGENTS.md` (one section pointing at the persona library and the skill)
- **Not touched:** application code, `packages/ui`, the integration-test harness, the Playwright config, CI workflows. No API routes, no entities, no migrations.

## Problem Statement

The PR loop already answers "does it work?" — `om-auto-verify-pr-ui` drives the changed surface with Playwright and posts screenshot evidence; module `__integration__` specs lock behavior in. Nothing in the loop answers **"can a user figure it out?"**:

1. **Usability feedback arrives quarterly, not per-PR.** Real user research happens in batches, long after the UI shipped. By the time a mislabeled button or a buried action surfaces in a session recording, three more features were built on top of it.
2. **Existing automation is omniscient.** `om-auto-verify-pr-ui` reads the diff, knows exactly which route to open and which button the author added, and drives it with discovered selectors. It verifies the *author's* mental model, so it is structurally incapable of noticing that no one else would ever find that button.
3. **Heuristic review doesn't scale into flows.** DS lint and guardian reviews catch token and component violations on static code; they cannot tell whether a five-screen invoice flow reads as five screens or as a maze.
4. **There is no vocabulary for friction in review.** Reviewers say "feels clunky" with no shared metric; authors reasonably push back. Counted backtracks, dead ends, and quoted mislabels give the discussion units.
5. **Fixes are unverifiable.** When a PR claims to "improve the create flow", there is no before/after mechanism showing that a previously observed point of confusion is actually gone.

## Proposed Solution

A synthetic user: a browser-driving run that is deliberately *less* informed than existing QA automation.

- **Personas are content, not code.** Each persona is a markdown file in `.ai/qa/personas/` with YAML frontmatter (name, age band, tech fluency, domain knowledge, patience budget, vocabulary quirks) and a prose behavior brief. Teams add their own personas the same way they add QA scenarios; two seeds ship with the spec (`first-contact-accountant`, `daily-ops-admin`).
- **Walkthrough contract:** input = persona id + task goal (natural language) + target (PR number or base URL). The navigator loop sees **only what a user sees** — the rendered page, its visible labels, and the accessibility tree — and picks its next action by reading, exactly like a person hunting for "the place where invoices live". Hard rule: no selector scripts, no source or diff access during navigation (the **knowledge firewall**, see Architecture).
- **Friction metrics, precisely defined** (see Architecture): steps taken vs. an optional shortest-known-path baseline, backtracks, dead ends, mislabels (self-reported with the offending label quoted verbatim), goal failure/abandonment, and hesitation markers. Each finding gets a severity on a four-level scale.
- **Reproducibility gate:** every walkthrough runs **N=2** with the same persona and goal; only friction observed in both runs is reported as a finding. Singletons are listed in a collapsed appendix as unreproduced.
- **Report:** one sticky PR comment (marker-matched, updated in place like other automation comments) with the friction table, annotated screenshots per finding, and short persona narration excerpts. `--compare <runId>` adds a resolved/persisting/new delta against a prior run.
- **Advisory only, by construction:** the skill never sets pipeline or QA labels, never fails a check, never blocks merge. It runs when a human adds the `needs-ux-walkthrough` label or invokes it manually.
- **Honest epistemics:** findings are phrased as hypotheses about real users, never as proof; the report template carries a fixed caveat block (see the dedicated section below).

## Architecture

### Skill layout and reuse

```
.ai/skills/om-ux-walkthrough/
└── SKILL.md            # arguments, workflow, rules — same shape as om-auto-verify-pr-ui

.ai/qa/personas/
├── AGENTS.md           # authoring rules: schema, review expectations, naming
├── first-contact-accountant.md
└── daily-ops-admin.md

.ai/tmp/om-ux-walkthrough/pr-{n}/run-{runId}/    # artifacts (gitignored tmp, mirrors auto-verify-pr-ui)
├── run-record.json     # machine-readable run record (schema in Data Models)
├── steps/step-NN.md    # per-step: perception summary, candidates, choice, rationale
└── screenshots/step-NN.png
```

The skill **reuses verbatim** from `om-auto-verify-pr-ui`: step-0 PR claim/lock with trap-guaranteed release, isolated worktree from the PR head, ephemeral env boot with `.ai/qa/ephemeral-env.json` reuse and started-by-this-run teardown discipline, default credentials from `mercato init`, the `qa-evidence/pr-{n}` branch + raw-URL mechanism for inline screenshots (with the same private-repo/no-push fallback), and the "never fabricate results; if the env cannot boot, post the blocker and stop" rule. This spec defines only what is new: personas, the firewall, the navigator loop, metrics, and the report.

### Run pipeline

1. **Setup (informed phase).** Read the PR body and diff *only* to select the walkthrough's entry point and, when the invoker gave no goal, derive one from the PR's user-facing intent. Output of this phase to the navigator is exactly four values: persona file content, goal sentence, start URL (normally the backend login page — reaching the feature is part of the task), and a credential role. Nothing else crosses.
2. **Env boot.** Reuse or start the ephemeral environment (`yarn test:integration:ephemeral:start`), read `base_url` from `.ai/qa/ephemeral-env.json`.
3. **Navigate — the persona loop, run twice (N=2).** Each iteration: capture the accessibility snapshot and screenshot; summarize what is visible in the persona's vocabulary; enumerate candidate actions with plausibility as *this persona* judges from labels alone; log a hesitation marker when >3 candidates are similarly plausible; act via Playwright (click/fill/navigate by visible label or role+name only); record the step. Loop ends on goal success (persona states the goal's observable outcome is on screen), patience-budget exhaustion, or the hard step cap.
4. **Metric extraction.** Compute metrics from the two step logs; keep only friction present in both runs (fingerprint match, below); assign severities.
5. **Report.** Render the markdown comment, push screenshots to the evidence branch, upsert the sticky comment by marker. With `--compare`, load the referenced `run-record.json` first and compute the delta.
6. **Teardown.** Standard: tear down only an env this run started, remove created worktree, release the lock — in a trap/finally.

### The knowledge firewall (hard rule)

During phase 3 the navigator MUST NOT read repository source, the PR diff, module registries, the database, API responses fetched out-of-band, or any prior QA artifact for this PR. Its entire input is the rendered page (accessibility tree + screenshot), its own step history, the persona, and the goal.

**Rationale:** the walkthrough measures *discoverability*. An author-informed driver already knows the answer ("the new button is `Add contact person`, on the detail tab") and will always find it in one step; the metric would measure nothing. The firewall is what makes a step count, a backtrack, or a mislabel meaningful — it is the difference between this skill and `om-auto-verify-pr-ui`, not an implementation nicety. Mechanically, SKILL.md enforces it by structure: phase 1 and phase 3 are separate steps with an explicit "hand over only these four values" boundary, phase 3's tool list excludes Read/Grep/Glob on the worktree, and the run record stores the phase-1 handoff so a reviewer can audit that nothing else leaked.

### Personas

Frontmatter schema (validated at run start; a persona failing validation aborts the run before the env boots):

```yaml
---
id: first-contact-accountant        # kebab-case, unique, doubles as --persona value
name: "Maria, staff accountant"
age_band: "45-55"
tech_fluency: low | medium | high   # calibrates candidate-action patience and jargon tolerance
domain_knowledge: "Accounting terms yes; this system: never seen it before."
goal_template: "Book an incoming invoice for {client} and send confirmation."   # optional default goal
patience_budget: 25                 # max navigator steps per run before abandoning
vocabulary:                          # quirks steering label matching
  - "Says 'book an invoice', never 'create a sales document'."
  - "Expects 'Clients', not 'Companies' or 'Accounts'."
---
Prose behavior brief: how this person scans a page (menu first? search first?),
what makes them give up, what they would mutter at a dead end. 10–20 lines.
```

Personas are reviewed like code (PRs against `.ai/qa/personas/`), versioned in git, and referenced by id + the persona file's git blob hash in every run record so a compare across runs knows whether the persona itself changed. `patience_budget` is the persona's own tolerance; a separate global hard cap (default 40 steps/run) bounds cost regardless of persona.

**Seed personas** (ship with the skill so the first invocation needs zero authoring):

- `first-contact-accountant` — Maria, staff accountant, 45–55, low tech fluency, deep accounting domain knowledge, has never seen this system. Scans the left nav top to bottom before trying search; abandons after two consecutive dead ends on the same screen. Vocabulary: "book an invoice", "clients", "confirmation" — never "sales document", "companies", or "dispatch". Patience budget 25. Exercises first-run discoverability, the signal quarterly research is slowest to deliver.
- `daily-ops-admin` — Piotr, operations admin, 28–35, high tech fluency, knows the system's information architecture from daily use but not the PR's new feature. Tries keyboard search first, tolerates jargon, but is impatient with extra steps: patience budget 15, and reads any confirmation dialog as friction unless it is destructive. Exercises efficiency regressions for existing users — the complement of Maria's discoverability signal.

### Friction metrics — definitions

A **step** is one committed interaction: a click, a form fill batch on one screen, a submit, or an explicit navigation. Snapshot reads are not steps.

| Metric | Definition | Detected by |
|---|---|---|
| Steps vs. baseline | Steps taken ÷ shortest-known-path step count. Baseline is optional, declared per golden task (or by the invoker via `--baseline <n>`); when absent, raw step count is reported without a ratio. | Step log count |
| Backtrack | Arrival at a normalized route (path minus ids/query) already visited earlier in the run, after having left it, without the goal state having advanced in between. | Route history diff |
| Dead end | A step whose interaction produced no perceivable progress: post-action accessibility snapshot is unchanged beyond a noise threshold, or shows an error/denied state, forcing the persona to choose again from the same screen. | Snapshot diff + error-state check |
| Mislabel | The persona self-reports, at the step where the mismatch is discovered, that a visible label led it to expect one thing and deliver another. MUST quote the label text verbatim and state the expectation. | Navigator self-report |
| Failed / abandoned goal | Run ends by patience-budget exhaustion, hard cap, or the persona declaring itself stuck — without the goal's observable outcome on screen. | Loop exit reason |
| Hesitation marker | A decision point with more than 3 candidate actions of similar persona-judged plausibility (no candidate clearly dominant). Logged with the candidate labels. | Navigator decision log |

**Severity scale for findings:** **S1** — goal failed or abandoned; a user like this persona does not complete the task. **S2** — goal reached but through a repeated dead-end/backtrack cluster (≥2 occurrences on the same screen) or a mislabel on the critical path. **S3** — isolated mislabel, single dead end, or hesitation cluster off the critical path. **S4** — observation (vocabulary mismatch, slow-feeling transition) with no measured detour.

**Finding fingerprint** (used for the N=2 reproducibility gate and for `--compare`): `metric type + normalized route + normalized label text (mislabels/hesitations) or empty`. Two occurrences match when fingerprints are equal.

### Report

One PR comment, upserted by marker `<!-- om-ux-walkthrough:report -->` (search existing comments for the marker; edit in place, never stack — the same sticky pattern as other house automation comments):

```markdown
<!-- om-ux-walkthrough:report -->
## 🧭 UX walkthrough — synthetic user report (advisory)

**Persona:** Maria, staff accountant (`first-contact-accountant` @ `a1b2c3d`) — **Goal:** "Book an invoice for Acme and send it"
**Outcome:** {reached in 19 steps (baseline 7) | abandoned at step 25} — runs: 2/2 consistent
**Env:** ephemeral @ {base_url} — role `admin@acme.com` — runId `{runId}`

### Friction findings (reproduced in both runs)
| # | Severity | Type | Where | What happened |
|---|---|---|---|---|
| 1 | S2 | Mislabel | /backend/customers/people | Label "Directory" read as company registry; persona expected "Clients". Quote: "Directory — is that companies? It opened staff." |
| 2 | S3 | Dead end | /backend/sales | Clicking the summary card produced no visible change. |

### Screenshots
![Finding 1 — step 06]({raw url})   <!-- annotated: red outline on the misread label -->

### Narration excerpts
> Step 6: "I need clients. I see 'Directory', 'Customers', 'Sales'. Trying 'Directory' — that word means the client book at my old firm."

<details><summary>Unreproduced observations (seen in one run only)</summary>…</details>
<details><summary>Epistemics — read before acting on this report</summary>{fixed caveat block, below}</details>

*Compare vs run `{prevRunId}`: 1 resolved, 1 persisting, 0 new.*   <!-- only with --compare -->
```

Annotated screenshots reuse the evidence-branch flow; annotation is a red outline drawn on the finding's element bounding box (from the accessibility snapshot) before upload. `--compare <runId>` loads the prior `run-record.json` (from the artifacts dir or the evidence branch, where a copy is pushed alongside the PNGs), matches findings by fingerprint, and prefixes the table with resolved / persisting / new markers.

### Triggering and arguments

- **Label:** a human adds `needs-ux-walkthrough` to a PR; the operator's periodic automation pass (the same loop that dispatches other `om-auto-*` skills) picks it up and invokes the skill, then removes the label on completion. The label is a *request*, never a gate: no branch protection, no check run, no pipeline label is ever derived from it.
- **Manual:** `/om-ux-walkthrough <prNumber|url> --persona <id> [options]`.

| Argument | Required | Meaning |
|---|---|---|
| `prNumber` \| `url` | yes | PR to walk (worktree + ephemeral boot), or a base URL of an already-running ephemeral env (report is then printed, not posted). |
| `--persona <id>` | yes | Persona file id from `.ai/qa/personas/`. |
| `--goal "…"` | no | Task goal. Fallback chain: this flag → persona `goal_template` → goal derived in phase 1 from the PR intent (the derivation is recorded verbatim in the run record so it is auditable). |
| `--baseline <n>` | no | Shortest-known-path step count for the ratio metric; omitted → raw step count only. |
| `--compare <runId>` | no | Prior run to diff against; adds resolved/persisting/new markers to the findings table. |
| `--runs <n>` | no | Reproducibility runs, default 2; `--runs 1` skips the gate and labels every finding unreproduced. |
| `--keep-env` | no | Leave an env this run started running on exit (same semantics as `om-auto-verify-pr-ui`). |

## Data Models

No database entities, no migrations, no tenant data. Two file-based schemas are the contract:

**Persona file** — frontmatter schema as specified above (`id`, `name`, `age_band`, `tech_fluency`, `domain_knowledge`, `goal_template?`, `patience_budget`, `vocabulary[]`) plus prose body.

**Run record** — `run-record.json` in the artifacts dir (and copied to the evidence branch):

```jsonc
{
  "runId": "2026-07-07-1432-a1b2",
  "pr": 3999, "headSha": "…",
  "persona": { "id": "first-contact-accountant", "blobHash": "a1b2c3d" },
  "goal": "…", "goalSource": "invoker|persona-template|derived-from-pr",
  "handoff": { "startUrl": "…", "role": "admin" },        // the audited firewall boundary
  "runs": [ { "steps": [ { "n": 1, "route": "…", "action": "…", "candidates": ["…"],
      "hesitation": false, "deadEnd": false, "screenshot": "steps/step-01.png" } ],
      "exit": "goal-reached|patience-exhausted|hard-cap|stuck" } ],
  "findings": [ { "severity": "S2", "type": "mislabel", "fingerprint": "…",
      "route": "…", "quote": "…", "screenshots": ["…"], "reproduced": true } ],
  "cost": { "steps": [19, 21], "modelTokens": 184000, "wallClockSec": 640 }
}
```

## API Contracts

None. No HTTP API routes are added or changed. The skill's external contracts are: its argument list, the persona frontmatter schema, the `run-record.json` shape, the sticky-comment marker `<!-- om-ux-walkthrough:report -->`, and the `needs-ux-walkthrough` label name. All are versioned in this spec; changing any of them is a spec update.

## Migration & Backward Compatibility

Analyzed against the 13 contract surfaces from [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md): **no impact on any of them.** No auto-discovery files, types, function signatures, import paths, event ids, widget spots, API routes, schema, DI names, ACL features, notification ids, CLI commands, or generated files change. Everything is additive content: one skill directory, one persona directory, one GitHub label, one section in `.ai/qa/AGENTS.md`. Removal is deletion with zero residue. The only shared resource is the ephemeral environment, and the skill inherits the existing reuse/teardown discipline, so concurrent QA runs behave exactly as they do today.

## Implementation Phases

1. **Persona library** — `.ai/qa/personas/AGENTS.md` (schema + authoring rules) and the two seed personas; frontmatter validation snippet used by the skill.
2. **Skill core** — `SKILL.md` with claim/worktree/env steps referenced from `om-auto-verify-pr-ui`, the phase-1/phase-3 firewall structure, the navigator loop, artifacts layout, and the report template. Single-run mode first.
3. **Metrics + N=2 gate** — step-log post-processing, fingerprints, severity assignment, reproduced-only reporting.
4. **Compare mode + evidence-branch run-record publishing.**
5. **Golden walkthrough** — the seeded-friction validation below, run end to end; tune the dead-end noise threshold and hesitation N against it before announcing the skill in `.ai/qa/AGENTS.md`.

## Honest Epistemics — what this signal is and is not

This section is normative: the caveat block in the report template MUST carry these points.

- **A synthetic user is a signal, not proof.** Findings are hypotheses about how a person like the persona might struggle — phrased in the report as "a first-contact accountant may read 'Directory' as the client registry", never "users cannot find clients". Confirmation still requires a human.
- **Anthropomorphizing risk.** The navigator does not get tired, distracted, or embarrassed; its "patience" is a step counter. Severity S1 means the *simulation* failed the task, which is evidence, not equivalence.
- **Prompt sensitivity and nondeterminism.** Different phrasings of the same goal, or two runs of the same phrasing, can take different paths. Mitigations, all mandatory: same persona blob + identical goal string across the N=2 runs; report only fingerprint-reproduced friction; keep both full step logs in the artifacts so divergence itself is inspectable.
- **Cost budget.** A run is bounded by the hard step cap (40/run), N=2 runs, and a per-invocation model-token budget recorded in `cost` and printed in the summary; the skill aborts with an honest PARTIAL report when a budget trips. Walkthroughs are label-requested precisely because they are too expensive to run on every push.
- **Vocabulary leakage.** The persona's quirks are written by the same team that named the UI; a persona can accidentally encode the house vocabulary and mask mislabels. Persona review (the `AGENTS.md` rules) asks authors to source vocabulary from real user language — support tickets, sales calls — not from the product.

## Validation Plan

- **Golden walkthrough (the acceptance test for the skill itself).** On a throwaway branch of the customers module, seed one deliberate friction: relabel the primary action on `/backend/customers/people/create` from its current label to a misleading one (e.g. "Register entry") without changing behavior. Run `first-contact-accountant` with goal "add a new contact person named Jan Kowalski". **Pass criteria:** both runs complete; the report contains ≥1 reproduced S2/S3 *mislabel* finding whose quote contains "Register entry" and whose route fingerprint is the create page; the goal is still reached (label misleads but does not block). Then fix the label, rerun with `--compare`, and assert the finding is marked *resolved* and no new S1/S2 appears.
- **Firewall audit.** During the golden run, verify from the transcript and `run-record.json` that phase 3 issued no Read/Grep/Glob against the worktree and that the recorded `handoff` contains only the four permitted values.
- **Reproducibility gate.** Force a single-run artifact with a synthetic singleton finding; assert it lands in the unreproduced appendix, not the findings table.
- **Sticky comment.** Invoke twice on the same PR; assert one comment exists (marker-matched edit), not two.
- **Environment integration.** Run with a pre-existing ephemeral env (`.ai/qa/ephemeral-env.json` present): assert reuse and no teardown; run without: assert boot and teardown. Artifacts land under `.ai/tmp/om-ux-walkthrough/…`, never under any module's `__integration__/` (per `.ai/qa/AGENTS.md`, no executable specs are added anywhere by this skill).
- **Persona validation.** A persona missing `patience_budget` aborts before env boot with a clear message.
- **Second-persona sanity.** Run `daily-ops-admin` against the unseeded flow; assert markedly fewer steps than `first-contact-accountant` and no S1/S2 findings — the two seeds must produce distinguishable signals or the persona dimension adds nothing.
- **Advisory guarantee.** After all runs: `gh pr view --json labels` diff shows no label changes beyond removal of `needs-ux-walkthrough` by the dispatching flow; no check runs created.

## Risks & Impact Review

| # | Risk / failure scenario | Severity | Affected | Mitigation | Residual |
|---|---|---|---|---|---|
| 1 | **False authority** — a red S1 table reads like a verdict; an author reworks a good flow to satisfy a simulation, or a reviewer treats the report as a blocker despite "advisory". | High | Product decisions, review culture | Normative epistemics block in every report; findings phrased as hypotheses; no labels/checks ever derived; `.ai/qa/AGENTS.md` section states explicitly that a walkthrough finding alone never justifies blocking a PR. | Medium — tone rules can't fully stop social pressure |
| 2 | **Nondeterministic noise** — two runs disagree, or reruns flip findings, eroding trust in the metric. | Medium | Signal credibility | N=2 same-seed gate reports only reproduced friction; singletons quarantined in the appendix; full step logs retained for inspection; golden walkthrough tunes thresholds before rollout. | Medium — LLM navigation stays stochastic |
| 3 | **Firewall leak** — the navigator peeks at the diff or source and "finds" everything in minimum steps; metrics silently become meaningless while looking healthy. | High | Core value of the skill | Structural phase separation with a four-value handoff recorded in the run record; phase-3 tool restrictions in SKILL.md; firewall audit is a standing item in the Validation Plan and in review of any SKILL.md change. | Low |
| 4 | **Cost runaway** — a lost persona loops through a large app for hundreds of model-heavy steps, twice. | Medium | Operator budget | Persona `patience_budget` + global 40-step hard cap per run + token budget with honest PARTIAL abort; label-triggered only, never on every push; cost printed in every summary. | Low |
| 5 | **Destructive walkthrough actions** — a goal-driven persona with admin credentials deletes or mutates data while exploring. | Medium | Shared ephemeral env, parallel QA runs | Runs target the disposable ephemeral env only (never a developer's dev DB or production URL — SKILL.md forbids non-ephemeral targets unless the invoker passes an explicit override flag); env teardown discipline inherited from `om-auto-verify-pr-ui`. | Low |
| 6 | **Persona rot / vocabulary leakage** — personas drift out of date or encode house jargon, masking real mislabels (see Epistemics). | Medium | Finding quality | Personas are reviewed content with authoring rules requiring externally sourced vocabulary; run records pin the persona blob hash so drift is visible in compares. | Medium — quality depends on authors |
| 7 | **Report spam / comment collisions** — repeated invocations stack comments or race another automation actor on the same PR. | Low | PR readability | Sticky marker-matched upsert (validated); step-0 claim lock shared with the other `om-auto-*` skills serializes actors. | Low |
| 8 | **Screenshot data leakage** — walkthrough screenshots capture values that shouldn't be public on the evidence branch. | Low | Repo hygiene | Ephemeral env contains only `mercato init` demo data; the inherited redact-or-omit rule from `om-auto-verify-pr-ui` applies to every posted image. | Low |

## Final Compliance Report

- **Spec conventions (`.ai/specs/AGENTS.md`):** date-titled OSS spec, no `SPEC-*` prefix, all required sections present; no enterprise scope.
- **QA conventions (`.ai/qa/AGENTS.md`):** no executable `.spec.ts` under `.ai/qa/tests`; no reliance on seeded data beyond `mercato init` defaults; ephemeral env reused via `ephemeral-env.json`; artifacts in `.ai/tmp/`, mirroring `om-auto-verify-pr-ui`.
- **Sibling-skill discipline:** claim/lock, worktree isolation, read-only on PR source, evidence-branch screenshots, never-fabricate reporting — all inherited by reference, not reimplemented.
- **Advisory guarantee:** no pipeline labels, no check runs, no merge gating — stated as a contract, enforced in the Validation Plan.
- **BC:** zero impact on all 13 contract surfaces; purely additive content, deletable without residue.
- **Epistemic honesty:** normative caveat block, hypothesis phrasing, reproducibility gate, and cost transparency are specified as requirements, not suggestions.

## Changelog

- **2026-07-21** — Implemented Phases 1–2 plus the contract surface of Phases 3–4 (skill instructions, not yet exercised live): `.ai/skills/om-ux-walkthrough/SKILL.md` with the phase-1/phase-3 knowledge-firewall structure (four-value handoff, phase-3 tool exclusions, mandatory per-run firewall audit recorded as `firewallAudit` in the run record), the six friction metrics + S1–S4 severities + fingerprint N=2 gate (`references/friction-metrics.md`, normative), the sticky report template with the fixed epistemics caveat block (`references/report-template.md`), and `--compare` semantics. Persona library shipped: `.ai/qa/personas/AGENTS.md` (authoring rules incl. mandatory synthetic-persona footer and externally-sourced-vocabulary rule) with seeds `first-contact-accountant` and `daily-ops-admin` per spec, plus a third starter persona `new-tenant-admin` (day-one tenant-admin setup discoverability — an addition beyond the spec's two seeds, requested at implementation time; the library is extensible by design). Frontmatter validation implemented as `scripts/validate-persona.mjs` (aborts before env boot; dry-run tested for valid, invalid, missing-`patience_budget`, and over-cap cases). Registered in `.ai/skills/tiers.json` (`automation` tier) + `.ai/skills/README.md`; new "Synthetic User Walkthroughs (advisory)" section in `.ai/qa/AGENTS.md` including the finding-never-blocks-a-PR statement. Deviations/follow-ups: (1) the `needs-ux-walkthrough` GitHub label is not created by this change — bootstrap once with the `gh label create` command documented in SKILL.md; (2) run-record additionally carries `firewallAudit` (implementation detail supporting the spec's firewall-audit validation item); (3) Phase 5 (golden walkthrough with seeded mislabel, threshold tuning for dead-end noise and hesitation N, second-persona sanity, sticky-comment and env-integration checks) requires a live ephemeral env + browser and was not executed in this docs-only implementation environment — it remains the acceptance gate before announcing the skill beyond the `.ai/qa/AGENTS.md` pointer.
- **2026-07-07** — Initial spec: `om-ux-walkthrough` skill (persona-driven synthetic user walkthroughs on PR UIs); persona library under `.ai/qa/personas/`; knowledge-firewall navigation rule; six friction metrics with S1–S4 severity and fingerprint-based N=2 reproducibility gate; sticky advisory PR report with `--compare` mode; `needs-ux-walkthrough` trigger label; golden walkthrough on the customers person-create flow as acceptance test.
