# Execution plan — record the before/after QA test-env lessons in the repo-local skill

Engine: om-auto-create-pr (steps: 3, --loop: no)

## Goal

Write down, in `.ai/skills/om-prepare-test-env/SKILL.md`, the traps that make a before/after UI QA
run silently produce **two screenshots of the same build** — so the next agent that captures browser
evidence on this repo cannot repeat them.

## Why now

While producing before/after evidence for PRs #4990 and #4992, the first "before" pass was invalid:
`test-env-up.sh --force` restarted the launcher but the repo CLI kept the previous commit's `.next`
artifacts, and on a second attempt the CLI reattached to the still-live app port
(`Reusing existing ephemeral environment at …`). The two runs produced byte-identical PNGs. That was
caught only because the file sizes matched exactly and the descriptor's `startedAt` had not moved —
an easy thing to miss, and the failure mode is *evidence that looks real and is not*, which is the
same class of problem tracked in #4391.

Three smaller traps cost time in the same session and belong next to it: the acting user cannot be
found by email (encrypted at rest) when seeding a row the UI must render; the Playwright browser
installer exits 0 without downloading anything when the sandbox is offline; and the backoffice login
form is client-hydrated, so an immediate fill+submit never navigates.

## Scope

- `.ai/skills/om-prepare-test-env/SKILL.md` — append four sections (three full, one compressed).

## Non-goals

- `.ai/scripts/test-env-up.sh` — the same lessons are already implemented there (an `app.commit`
  guard in the descriptor plus a port-free wait on forced rebuilds), but the file matches
  `.gitignore:145` (`.ai/scripts/test-env-*`), so it is generated per checkout and is not committed.
- Any change to the shared `om-prepare-test-env` skill itself, or to its entrypoint contract.
- Any code, test, schema, API or UI change. This run is documentation only.

## Risks

- Low. A markdown-only addition to a repo-local agent skill; nothing imports it and no gate command
  parses it. The only real risk is documenting a workaround that later becomes wrong — mitigated by
  dating each section and describing the observable symptom rather than a fixed command.

## Implementation Plan

### Phase 1: Write the sections

- 1.1 Append the four sections to `.ai/skills/om-prepare-test-env/SKILL.md`, trimmed as agreed:
  "Switching commits on one worktree" and "Seeding rows the UI needs" in full, "Driving the
  backoffice login" shortened, "Playwright browsers offline" compressed to two sentences with the
  machine-specific cache revision dropped.

### Phase 2: Validate

- 2.1 Re-read the diff for scope creep and confirm no file outside the skill doc changed.
- 2.2 Run the configured validation gate commands that apply to a docs-only change.

## Progress

PR: #4999

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Write the sections

- [x] 1.1 Append the four trimmed sections to the repo-local skill — fd9e9ea58

### Phase 2: Validate

- [x] 2.1 Re-read the diff and confirm the change is confined to the skill doc — fd9e9ea58
- [x] 2.2 Run the docs-relevant validation gate — `yarn agents:check-budget` and `yarn lessons:check` both exit 0

### Phase 3: Address review (added 2026-08-05, after @pkarw's changes-requested)

- [x] 3.1 Fix the Medium: rewrite the "when you must stay in SQL" bullet so it describes the keyed
  `v2:` HMAC, the legacy unkeyed fallback and the two-candidate match, instead of a plain
  deterministic digest — 50db99e2d
- [x] 3.2 Nit 2 — stop asserting the gitignored generated script's internals for `--force-rebuild`;
  name the CLI-level cache variable the flag must invalidate — 50db99e2d
- [x] 3.3 Nit 3 — anchor the `entities.ts:8` citation to a greppable symbol
  (`defaultEncryptionMaps`, `encryption.ts:7`) — 50db99e2d
- [x] 3.4 Re-verify every citation in the changed lines resolves at the stated line, and re-run the
  docs-relevant gate — 16/16 citations exact, both commands exit 0
