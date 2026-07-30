# Friction Metrics — Normative Definitions

Source of truth for `om-ux-walkthrough` metric extraction (workflow step 4). These definitions
come from the spec `.ai/specs/2026-07-07-ux-synthetic-user-walkthroughs.md`; changing any of
them is a spec update.

## What counts as a step

A **step** is one committed interaction: a click, a form fill batch on one screen, a submit, or
an explicit navigation. Snapshot reads are not steps.

## The six metrics

| Metric | Definition | Detected by |
|---|---|---|
| Steps vs. baseline | Steps taken ÷ shortest-known-path step count. Baseline is optional, declared per golden task (or by the invoker via `--baseline <n>`); when absent, raw step count is reported without a ratio. | Step log count |
| Backtrack | Arrival at a normalized route (path minus ids/query) already visited earlier in the run, after having left it, without the goal state having advanced in between. | Route history diff |
| Dead end | A step whose interaction produced no perceivable progress: post-action accessibility snapshot is unchanged beyond a noise threshold, or shows an error/denied state, forcing the persona to choose again from the same screen. | Snapshot diff + error-state check |
| Mislabel | The persona self-reports, at the step where the mismatch is discovered, that a visible label led it to expect one thing and deliver another. MUST quote the label text verbatim and state the expectation. | Navigator self-report |
| Failed / abandoned goal | Run ends by patience-budget exhaustion, hard cap, or the persona declaring itself stuck — without the goal's observable outcome on screen. | Loop exit reason |
| Hesitation marker | A decision point with more than 3 candidate actions of similar persona-judged plausibility (no candidate clearly dominant). Logged with the candidate labels. | Navigator decision log |

Reporting requirement: every metric occurrence in the report is anchored to a **concrete
moment** — step number, normalized route, verbatim label quote where applicable, and a
screenshot reference. Unanchored observations are not reportable.

Tuning note: the dead-end snapshot-diff noise threshold and the hesitation candidate count
(N>3) are tuned against the golden walkthrough (spec Validation Plan) before the skill is
announced; do not silently change them afterwards.

## Severity scale for findings

- **S1** — goal failed or abandoned; a user like this persona does not complete the task.
- **S2** — goal reached but through a repeated dead-end/backtrack cluster (≥2 occurrences on
  the same screen) or a mislabel on the critical path.
- **S3** — isolated mislabel, single dead end, or hesitation cluster off the critical path.
- **S4** — observation (vocabulary mismatch, slow-feeling transition) with no measured detour.

S1 means the *simulation* failed the task — evidence, not equivalence with a real user failing.

## Finding fingerprint

Used for the reproducibility gate and for `--compare`. The fingerprint is per metric type:

```
mislabel / hesitation:      fingerprint = metric type + normalized route + normalized label text
dead end:                   fingerprint = metric type + normalized route + normalized action discriminator
failed / abandoned goal:    fingerprint = metric type + goal (the identical goal string)
backtrack / steps-vs-base:  fingerprint = metric type + normalized route
```

- Normalized route = path with ids and query strings stripped.
- Normalized label text = trimmed, case-folded, whitespace-collapsed visible label.
- Normalized action discriminator (dead ends) = the visible label of the action that produced
  no progress, normalized as above; when the action has no visible label, the normalized
  role+name of the acted-on element. This keeps two *distinct* dead ends on the same route
  distinguishable instead of collapsing into one fingerprint.
- Failed/abandoned goals fingerprint on `type + goal` because the route where a
  nondeterministic run happens to give up is unstable across runs; the abandonment route is
  recorded on the finding as detail only (its `route` field), never in the fingerprint.
- Two occurrences match when fingerprints are equal.
- **Reproducibility gate:** a finding requires its fingerprint to occur in **at least 2 runs**.
  With the default `--runs 2` that means both runs; with `--runs <n>` for n > 2, ≥2 of the n
  runs suffice. Singletons go to the collapsed "unreproduced observations" appendix. With
  `--runs 1` the gate is skipped and every finding is labeled unreproduced.
- **Compare classification:** *resolved* = fingerprint in prior run only; *persisting* = in
  both; *new* = in current run only.

## Run record schema (`run-record.json`)

Written to `.ai/tmp/om-ux-walkthrough/pr-{n}/run-{runId}/run-record.json` and copied to the
evidence branch alongside the PNGs (published through the `attach-image-evidence` op in
`.ai/trackers/github.md` with slug `pr-{n}`; that op defines the slash-free `qa-evidence-…`
branch naming).

```jsonc
{
  "runId": "2026-07-07-1432-a1b2",
  "pr": 3999, "headSha": "…",
  "persona": { "id": "first-contact-accountant", "blobHash": "a1b2c3d" },
  "goal": "…", "goalSource": "invoker|persona-template|derived-from-pr",
  "handoff": { "startUrl": "…", "role": "admin" },        // the audited firewall boundary
  "firewallAudit": "clean",                                // or "violated: <what>"
  "runs": [ { "steps": [ { "n": 1, "route": "…", "action": "…", "candidates": ["…"],
      "hesitation": false, "deadEnd": false, "screenshot": "steps/step-01.png" } ],
      "exit": "goal-reached|patience-exhausted|hard-cap|stuck|budget-exhausted" } ],
  "findings": [ { "severity": "S2", "type": "mislabel", "fingerprint": "…",
      "route": "…", "quote": "…", "screenshots": ["…"], "reproduced": true } ],
  "cost": { "steps": [19, 21], "modelTokens": 184000, "wallClockSec": 640 }
  // cost.steps: one entry per run, in run order — array length equals the effective --runs n
}
```

`runId` format: `YYYY-MM-DD-HHMM-<4 hex>`. The `handoff` object records only the two values not
already top-level (start URL, credential role); persona content and goal are pinned by
`persona.blobHash` and `goal`.
