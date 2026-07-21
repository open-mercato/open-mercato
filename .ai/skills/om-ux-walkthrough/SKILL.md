---
name: om-ux-walkthrough
description: Persona-driven synthetic user walkthrough of a PR's UI. Boots the PR in the ephemeral integration environment, drives a real flow the way a specific persona would — reading only visible labels, no selectors, no source access — and posts an advisory friction report (steps vs baseline, backtracks, dead ends, mislabels, abandoned goals, hesitation markers) as a sticky PR comment with screenshots. Never a merge gate. Use when the user says "UX walkthrough PR <n>", "run a persona through PR <n>", "synthetic user test", "friction report for PR <n>", or "can a user figure out PR <n>".
---

# UX Walkthrough — Synthetic User Friction Reports

Take an existing PR, boot its UI, and attempt a task **the way a specific user would** — a
persona from `.ai/qa/personas/` navigating by visible labels alone. Produce quantified friction
metrics and post them as one sticky, **advisory-only** PR comment.

This skill is a sibling of `om-auto-verify-pr-ui` (external skill, installed at
`.agents/skills/om-auto-verify-pr-ui/SKILL.md`) and answers the question that skill cannot:
not "does it work?" but **"can a user figure it out?"**. `om-auto-verify-pr-ui` is omniscient —
it reads the diff, knows which button the author added, and verifies the author's mental model.
This skill is deliberately *less* informed: its value comes entirely from what the navigator
does **not** know (see the knowledge firewall below).

Companion system: `om-ux-product-design` (separate branch/PR) covers heuristic and
design-review UX evaluation with an evidence-tagged severity model. This skill is
philosophically aligned with it — every finding here is an evidence-tagged **synthetic
observation**, i.e. hypothesis-grade evidence, never research-grade — but shares no files with
it and runs independently.

## Advisory guarantee (hard rule)

- This skill NEVER sets pipeline or QA labels, never creates or fails a check run, never
  blocks merge, and never derives any gating state from its findings.
- The only label it touches is removing `needs-ux-walkthrough` after a label-triggered run
  (that label is a *request*, not a gate).
- A walkthrough finding alone never justifies blocking a PR — see `.ai/qa/AGENTS.md`.

## Arguments

| Argument | Required | Meaning |
|---|---|---|
| `prNumber` \| `url` | yes | PR to walk (worktree + ephemeral boot), or a base URL of an already-running ephemeral env (report is then printed, not posted). |
| `--persona <id>` | yes | Persona file id from `.ai/qa/personas/`. |
| `--goal "…"` | no | Task goal. Fallback chain: this flag → persona `goal_template` → goal derived in phase 1 from the PR intent (derivation recorded verbatim in the run record so it is auditable). |
| `--baseline <n>` | no | Shortest-known-path step count for the ratio metric; omitted → raw step count only. |
| `--compare <runId>` | no | Prior run to diff against; adds resolved/persisting/new markers to the findings table. |
| `--runs <n>` | no | Reproducibility runs, default 2; `--runs 1` skips the gate and labels every finding unreproduced. |
| `--keep-env` | no | Leave an env this run started running on exit (same semantics as `om-auto-verify-pr-ui`). |

## Reused verbatim from `om-auto-verify-pr-ui`

Follow the sibling skill's machinery without reimplementing it:

- **Step-0 PR claim/lock** with trap-guaranteed release (assignee + `in-progress` +
  claim comment; release even on failure).
- **Isolated worktree** from the PR head under `.ai/tmp/` — never the primary worktree,
  never nested; read-only on PR source.
- **Ephemeral env** boot with `.ai/qa/ephemeral-env.json` reuse and started-by-this-run
  teardown discipline; default credentials from `mercato init`
  (`superadmin@acme.com` / `admin@acme.com` / `employee@acme.com`, password `secret`).
- **Evidence branch** `qa-evidence/pr-{n}` + raw-URL mechanism for inline screenshots, with
  the same private-repo/no-push fallback (artifact paths instead of inline images).
- **Never fabricate results**: if the env cannot boot, post the blocker, keep status honest,
  release the lock, stop. Redact-or-omit rule for every posted screenshot.

## Triggering

- **Label:** a human adds `needs-ux-walkthrough` to a PR; the operator's periodic automation
  pass (the same loop dispatching other `om-auto-*` skills) invokes this skill and removes the
  label on completion. The label must exist in the repo — bootstrap once with
  `gh label create needs-ux-walkthrough --description "Request an advisory synthetic-user UX walkthrough" --color BFD4F2`.
- **Manual:** `/om-ux-walkthrough <prNumber|url> --persona <id> [options]`.

## Workflow

### 0. Claim the PR

Follow `om-auto-verify-pr-ui` step 0 verbatim (skip when the target is a bare URL). Use the
claim-comment id `om-ux-walkthrough`. Wrap all teardown (step 6) in a trap/finally so the lock
always releases.

### 1. Setup — the informed phase

This is the ONLY phase allowed to read the PR.

1. Validate the persona **before anything expensive**:

```bash
node .ai/skills/om-ux-walkthrough/scripts/validate-persona.mjs {personaId}
PERSONA_BLOB=$(git rev-parse ":.ai/qa/personas/{personaId}.md" 2>/dev/null || git hash-object .ai/qa/personas/{personaId}.md)
```

   A persona failing validation aborts the run before the env boots, with the validator's
   message as the reason.

2. Read the PR body and diff *only* to select the walkthrough's **entry point** and, when the
   invoker gave no goal and the persona has no `goal_template`, derive a goal sentence from the
   PR's user-facing intent. Record the derivation verbatim in the run record
   (`goalSource: "derived-from-pr"`).

3. Produce the **handoff** — exactly four values, nothing else crosses into phase 3:

   1. persona file content
   2. goal sentence
   3. start URL (normally the backend login page — *reaching the feature is part of the task*)
   4. credential role (`superadmin` / `admin` / `employee` — pick the role such a user would
      realistically have)

   Store the handoff in `run-record.json` under `handoff` so a reviewer can audit that nothing
   else leaked.

### 2. Env boot

Reuse a running env when `.ai/qa/ephemeral-env.json` shows `"status":"running"`; otherwise
`yarn test:integration:ephemeral:start` and record `STARTED_ENV=1`. Read `base_url` from
`.ai/qa/ephemeral-env.json`. Targets MUST be the disposable ephemeral env only — never a
developer's dev DB or a production URL — unless the invoker passes an explicit
`--allow-non-ephemeral-target` override and confirms in chat.

### 3. Navigate — the persona loop (run twice, N=2)

Run the loop `--runs` times (default 2) with the **same persona blob and the identical goal
string**. Each loop iteration:

1. Capture the accessibility snapshot and a screenshot of the current page.
2. Summarize what is visible **in the persona's vocabulary** — what would this person say this
   screen is?
3. Enumerate candidate actions with plausibility *as this persona judges from labels alone*.
   Log a **hesitation marker** when more than 3 candidates are similarly plausible (no clear
   dominant).
4. Act via Playwright — click / fill / navigate **by visible label or role+name only**. No CSS
   selectors, no test ids, no URL guessing beyond what a user would type.
5. Record the step to `steps/step-NN.md`: perception summary, candidates, choice, rationale,
   plus the structured step entry in the run record (route, action, candidates, hesitation,
   deadEnd, screenshot).

Loop exit: **goal success** (the persona states the goal's observable outcome is on screen, in
its own words), **patience-budget exhaustion** (persona frontmatter), or the **global hard cap**
(40 steps/run). Also abort honestly with a PARTIAL report when the per-invocation model-token
budget trips; record actuals under `cost`.

#### The knowledge firewall (hard rule — this is the skill)

During phase 3 the navigator's **entire allowed input** is:

1. the rendered page — accessibility tree + screenshot,
2. its own step history from this run,
3. the persona file content,
4. the goal sentence.

The navigator MUST NOT read: repository source or the PR diff, module registries or route
manifests, the database, API responses fetched out-of-band, prior QA artifacts for this PR, the
spec, or any internal name not visible in the rendered UI. Concretely: **no `Read`/`Grep`/`Glob`
against the worktree during phase 3** — the phase-3 tool surface is browser driving plus
appending to the artifacts dir, nothing else.

**Why this matters (do not optimize it away):** the walkthrough measures *discoverability*. An
author-informed driver already knows the answer and finds every button in one step; every
metric below would silently measure nothing while looking healthy. The firewall is the
difference between this skill and `om-auto-verify-pr-ui`, not an implementation nicety. A
walkthrough that peeks has not "helped the persona" — it has cheated, and its report is
misinformation.

**Verification step (mandatory, per run):** after phase 3, before rendering the report, audit
the transcript: confirm no worktree reads/greps/globs occurred during navigation and that
`handoff` in the run record contains only the four permitted values. Record the outcome as
`"firewallAudit": "clean" | "violated: <what>"` in the run record. If violated, the run is
invalid — say so in the report and do not present its metrics as findings.

### 4. Metric extraction

Compute the six friction metrics from the step logs per
`references/friction-metrics.md` (definitions are normative there):
**steps vs. baseline, backtracks, dead ends, mislabels, failed/abandoned goal, hesitation
markers**. Then:

- Fingerprint every observation: `metric type + normalized route + normalized label text
  (mislabels/hesitations) or empty`.
- Keep as **findings** only friction whose fingerprint appears in both runs (N=2 gate);
  singletons go to the unreproduced appendix. With `--runs 1`, every finding is labeled
  unreproduced.
- Assign severities S1–S4 per the scale in `references/friction-metrics.md`.

### 5. Report

Render the sticky PR comment from `references/report-template.md`:

- Upsert by marker `<!-- om-ux-walkthrough:report -->` — search existing comments for the
  marker and edit in place; never stack a second comment.
- Every finding cites **concrete moments**: the step number, the route, the verbatim label
  quote (mislabels), and an annotated screenshot — a red outline drawn on the finding's element
  bounding box (from the accessibility snapshot) before upload. Metrics with no concrete
  moment attached are vibes; do not post them.
- Push PNGs and a copy of `run-record.json` to the `qa-evidence/pr-{n}` branch (sibling
  mechanism); fall back to artifact paths when pushing is unavailable.
- The report MUST include the fixed epistemics caveat block from the template, verbatim —
  it is normative, not decoration.
- **`--compare <runId>`:** load the referenced `run-record.json` (artifacts dir or evidence
  branch), match findings by fingerprint, and prefix the table with **resolved** (in prior, not
  now) / **persisting** (both) / **new** (now only) markers plus the summary line. This is how
  a PR claiming "improve the create flow" proves a previously reported friction is actually
  gone. Note in the compare line when the persona blob hash differs between the runs.
- URL-target mode (no PR): print the report to the user instead of posting.

Artifacts layout (gitignored tmp, mirrors the sibling):

```
.ai/tmp/om-ux-walkthrough/pr-{n}/run-{runId}/
├── run-record.json     # schema: references/friction-metrics.md § Run record
├── steps/step-NN.md
└── screenshots/step-NN.png
```

### 6. Teardown

Standard, in the trap/finally: tear down only an env this run started (unless `--keep-env`),
remove any worktree this run created, remove `needs-ux-walkthrough` when the run was
label-triggered, release the lock with a completion comment. Confirm no other label changed —
`gh pr view --json labels` before/after must differ only by `needs-ux-walkthrough` (and the
`in-progress` lock).

### 7. Summary to the user

```text
om-ux-walkthrough: PR #{n} — {title}
Persona: {name} ({id} @ {blobHash}) — Goal: "{goal}" ({goalSource})
Outcome: {reached in N steps (baseline B) | abandoned at step N} — runs {k}/{k} consistent
Findings: {x} reproduced ({S1}/{S2}/{S3}/{S4}), {y} unreproduced
Firewall audit: {clean | VIOLATED — run invalid}
Cost: steps {a},{b} · ~{tokens} tokens · {sec}s
Report: {comment url | printed}
Labels: unchanged{ except needs-ux-walkthrough removed}
```

## Personas

- Library: `.ai/qa/personas/` — authoring rules in `.ai/qa/personas/AGENTS.md`. Seeds:
  `first-contact-accountant` (first-run discoverability), `daily-ops-admin` (efficiency for
  existing users), `new-tenant-admin` (day-one setup discoverability).
- Personas are SYNTHETIC and must NEVER be presented as real users or real research — not in
  reports, not in summaries, not in follow-up discussion. Findings are phrased as hypotheses:
  "a first-contact accountant may read 'Directory' as the client registry", never "users cannot
  find clients".
- Every run record pins `persona.id` + git blob hash so compares detect persona drift.

## Rules

- Advisory only, by construction: no pipeline/QA labels, no check runs, no merge gating, ever —
  regardless of severity found.
- The knowledge firewall is inviolable during phase 3; the firewall audit is mandatory and its
  result is printed. A violated run's metrics are not findings.
- Always N=2 with identical persona blob + goal string unless `--runs` says otherwise; only
  fingerprint-reproduced friction is reported as a finding.
- Bounded cost: persona `patience_budget`, global 40-step hard cap per run, token budget with
  honest PARTIAL abort; costs recorded in the run record and printed. Label-requested, never
  on-every-push.
- Ephemeral env targets only (explicit override + user confirmation required otherwise);
  read-only on PR source; artifacts under `.ai/tmp/om-ux-walkthrough/` only — never under any
  module's `__integration__/`; this skill adds no executable specs anywhere
  (per `.ai/qa/AGENTS.md`).
- Report only what was observed; never fabricate steps, screenshots, or outcomes; redact or
  omit sensitive screenshot content.
- Sticky comment upsert by marker; never stack report comments.
