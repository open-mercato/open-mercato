# Execution plan — add `om-verify-pr-ui` skill

**Slug:** add-om-verify-pr-ui-skill
**Date:** 2026-06-19
**Branch:** feat/add-om-verify-pr-ui-skill

## Goal

Add a new automation skill `om-verify-pr-ui` that, given a PR number, checks the
PR out in an isolated worktree, boots it locally against the ephemeral
integration environment, derives a UI QA scenario from the diff, drives it with
Playwright while capturing screenshots, posts the screenshots + a verification
report as a PR comment to help QA, and — only when the PR diff defines no
integration test — posts a follow-up comment with a ready-to-implement
integration-test scenario (recommending `/om-integration-tests`).

## Scope

- New skill folder `.ai/skills/om-verify-pr-ui/SKILL.md` (instructions only; no
  bundled scripts needed — it reuses existing repo commands).
- Register the skill in `.ai/skills/tiers.json` under the `automation` tier.
- Add the skill row to the `automation` table in `.ai/skills/README.md`.
- Add the skill to the PR-automation Task Router brace-list in `AGENTS.md`.

## Non-goals

- No code/module changes, no generated files, no new dependencies.
- The skill itself never modifies PR source code, never pushes to the PR
  branch, never merges. It only reads code, runs the app, posts comments,
  optionally pushes an evidence branch, and (opt-in) applies QA labels.
- No changes to existing skills, CI, or the ephemeral-env tooling.

## Design decisions

- Mirror `om-auto-review-pr` claim/worktree/lock-release discipline (claim the
  PR with assignee + `in-progress` + claim comment; release on exit), NOT the
  `om-auto-create-pr` "open a PR" flow — this skill operates on an existing PR.
- Reuse the running ephemeral env from `.ai/qa/ephemeral-env.json` when present;
  otherwise `yarn test:integration:ephemeral:start`. Default creds:
  superadmin@acme.com / admin@acme.com / employee@acme.com (password `secret`).
- Screenshot delivery: push PNGs to a dedicated `qa-evidence/pr-{n}` branch on
  `origin` and reference raw URLs (render inline for public repos); document the
  private-repo / no-push fallback (link artifact paths + Playwright HTML report).
- Test-presence detection: scan PR diff file list against integration glob
  `**/__integration__/**/*.spec.ts`; only post the follow-up scenario when none
  is present (per the brief).
- QA-label policy is conservative: default posts evidence only (helps QA, no
  label flip). `--self-qa-signoff` applies `qa-approved` + `qa-self-verified`
  via the AGENTS.md self-QA exception (green run + attached screenshots +
  `needs-qa` && !`skip-qa`). `--apply-failure` applies `qa-failed` on a failed
  run. This respects the house rule that auto-skills don't casually flip
  `qa-approved`.

## Risks

- Docs-only; the deliverable is instructions for a future agent, so the main
  risk is prescribing an unsafe or non-working procedure. Mitigated by reusing
  verified repo commands (`yarn test:integration:ephemeral:start`, the
  `.ai/qa/tests/playwright.config.ts` runner) and by making destructive/policy
  actions (label flips, evidence-branch push) explicit and opt-in.
- No contract surface touched. tiers.json stays schema-valid; README/AGENTS.md
  edits are additive.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Author the skill

- [x] 1.1 Write `.ai/skills/om-verify-pr-ui/SKILL.md`
- [x] 1.2 Register in `tiers.json`, `README.md`, and `AGENTS.md` router

### Phase 2: Validate & ship

- [x] 2.1 Validate tiers.json (JSON parse), re-read diff, open PR against develop with labels
