# Execution plan — document `yarn install-skills` as an explicit fresh-clone step (adopted from PR #5839)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-09-03 because PR #5839 carried no execution plan.
**PR:** #5839 · **Branch:** `fix/issue-5773-shared-skill-install-docs` · **Base:** `develop`
**Author:** @adeptofvoltron — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Merging this PR must make the shared `open-mercato/skills` bootstrap (`yarn install-skills`) visible as an explicit, clearly optional step in every fresh-clone setup path, so a contributor using an AI coding agent no longer discovers mid-task that `.agents/skills/` was never populated — while keeping the installation manual and deliberately out of `postinstall`.

## Scope

- `apps/docs/docs/installation/setup.mdx` — the native fresh-clone flow, the Windows-native monorepo flow, and the Docker wrapper-command list.
- `README.md` — the "Learn AI Engineering like we do!" section.
- `apps/docs/__tests__/install-skills-docs.test.mjs` + `apps/docs/package.json` — the docs-focused guard that pins the referenced script names to the scripts that actually exist.
- Finishing the pipeline work the interrupted chain never performed on this PR: the authoritative review pass, the validation gate, the summary comment, and the label/draft finalization.

## Non-goals

- **Moving `yarn install-skills` into `postinstall`.** Issue #5773 explicitly rules this out: the command reaches the network and fetches an external collection, and contributors who do not use a coding agent should not pay that cost implicitly.
- **Rewriting the skills tier system or `.ai/skills/README.md`.** This run documents the existing bootstrap; it does not redesign it.
- **Fixing the red `audit` check.** It fails on two repository-wide `browserslist` advisories (GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g) that this PR neither introduced nor can influence — the branch changes no dependency manifest and no lockfile, and open PR #5857 fails the same job on the same base. It belongs in a dedicated dependency/allowlist PR; see Risks.
- **Manual QA.** The change touches no `.tsx`, no `packages/ui/src/**`, and no `**/components/**` file, leaves the DB and API surface untouched, and ships its own automated check — the automated-verification exemption applies and the PR already carries `skip-qa`.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The goal is to document `yarn install-skills` as an explicit, opt-in fresh-clone step across the native, Windows-native, and Docker paths | Issue #5773 "Problem"/"Proposed documentation flow" sections and its six acceptance criteria | high |
| The manual-install design is deliberate and must be preserved | Issue #5773 "Scope": "Do **not** move `yarn install-skills` into `postinstall`" | high |
| The documentation work itself is already implemented | Commit `2a1882fd` on this branch touches exactly the four files named in Scope, and the PR body's acceptance-criteria checklist is fully ticked | high |
| The pipeline work is unfinished: the chain died mid-review | PR comments — `om-open-pr` handed the lock to `om-auto-review-pr` at 2026-09-02T11:32:51Z, which posted a take-over comment and then nothing: no review verdict, no summary comment, no `Tracking plan:` line, and the PR is still a draft | high |
| Acceptance criterion 5 ("states that this remains manual and is intentionally not part of `yarn install` / `postinstall`") is only partially met | `setup.mdx` says "`yarn install` does not install agent skills", which states the fact but not that the omission is intentional — a reader can still read it as an oversight worth "fixing" | medium |
| The red `audit` check is inherited, not caused here | The branch diff contains no `package.json` dependency change and no lockfile change; the failing advisories are on `browserslist`, a transitive build-time dependency; open PR #5857 fails the same check on the same base | high |
| `skip-qa` is the correct QA posture | `AGENTS.md` automated-verification exemption, matched against the diff (docs + one Node test file) | high |

## Assumptions

- **The author considers the prose itself finished.** The PR body ticks every acceptance criterion, so this run treats the documentation as written and does not rewrite tone or placement — it only closes the one criterion the text under-delivers on (the intentionality of the manual step). If the author wanted a different structure, editing this plan or the PR is the correction path.
- **The docs test is the "docs-focused check" acceptance criterion 6 asks for.** Combined with Docusaurus's `onBrokenLinks: 'throw'`, which already validates internal links on every docs build, that criterion is satisfied without adding a link checker; the most reversible reading is to keep the existing test rather than build new tooling.
- **The interrupted review pass still needs to run.** No verdict was ever posted, so this run assumes none happened and performs it, rather than assuming a silent pass.
- **The `audit` failure will be resolved by someone else.** Rolling a dependency bump into a docs PR would widen its blast radius past `risk-low`; the more reversible default is to disclose the failure on the PR and leave the fix to a dependency PR.

## Risks

- **The goal was inferred from the PR and issue, not stated in a plan** (the plan never existed). Confidence is high because issue #5773 states acceptance criteria explicitly, but the phase breakdown below is this run's judgment.
- **The `audit` check stays red on this PR.** It is a required-looking check that this branch cannot turn green; the PR is mergeable only once the `browserslist` advisories are allowlisted or the dependency is bumped on `develop`. This is disclosed in the summary comment rather than waited on.
- **Docs drift.** The new test pins script *names*, not prose accuracy, so a future change to what `yarn install-skills` actually does could leave the description stale without failing anything. Accepted: pinning prose would make the test brittle.

## External references

- Issue #5773 — <https://github.com/open-mercato/open-mercato/issues/5773> (goal and acceptance criteria).
- Issue #5251 — the harness session report that recorded the original failure mode (cited by #5773, not re-read here).
- Issue #4155 — established the canonical `.agents/skills/` layout (cited by #5773 as context).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Document `yarn install-skills` in the native fresh-clone flow, the Windows-native monorepo flow, and the Docker wrapper commands in `apps/docs/docs/installation/setup.mdx` — 2a1882fd
- [x] 1.2 Add the repo-specific `yarn install-skills` command to the README's AI-engineering section — 2a1882fd
- [x] 1.3 Add `apps/docs/__tests__/install-skills-docs.test.mjs` pinning the referenced script names, and register it in the docs `test` script — 2a1882fd

### Phase 2: Close the remaining acceptance criterion

- [x] 2.1 State explicitly in `setup.mdx` that keeping the skill install manual is a deliberate design decision and not part of `yarn install`/`postinstall`, and extend the docs test to pin that intent so the sentence cannot silently disappear — fac85a7cb

### Phase 3: Validation

- [x] 3.1 Run the docs validation gate for this docs-only change (`yarn workspace open-mercato-docs test` — full Docusaurus build plus every docs test, including the new one) and re-read the diff for scope creep — 18/18 tests pass, Docusaurus build succeeds; the one broken-anchor warning on `/installation/wsl2` is pre-existing and untouched by this branch

### Phase 4: Review and finalization

- [x] 4.1 Run the authoritative `om-auto-review-pr {prNumber} --autofix` pass the interrupted chain never completed, and land any actionable findings as new commits — approvable verdict, no blockers; a formal GitHub approval is impossible because the automation authors this PR, so the merge still needs a human reviewer
- [x] Post-review fix: cover the monorepo (macOS/Linux/Windows tabs) and WSL2 fresh-clone bootstrap flows with the agent-skills step, and extend the docs guard to every fresh-clone guide — 2cc665883
- [x] 4.2 Post the resume summary comment, normalize labels, flip the PR body to `Status: complete`, promote the draft to ready, and release the `in-progress` lock
