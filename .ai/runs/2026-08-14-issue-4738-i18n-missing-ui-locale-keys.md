# Execution plan — land the review follow-ups on PR #5272 so the create-app i18n mirror fix can merge (adopted from PR #5272)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-14 because PR #5272 carried no execution plan (the original run shipped through `om-open-pr` without committing one).
**PR:** #5272 · **Branch:** `fix/issue-4738-i18n-missing-ui-locale-keys` · **Base:** `develop`
**Author:** @Paul-Mlodochowki — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Clear the four items @pkarw raised in the `CHANGES_REQUESTED` review of PR #5272 so the create-app locale-mirror fix for #4738 becomes approvable, without widening the change beyond what that review asked for.

## Scope

- `packages/create-app/src/lib/template-i18n-parity.test.ts` — strengthen the gate so it asserts what its title claims.
- `scripts/template-sync.ts` — export `SYNC_FOLDERS` for the test to import; refresh the file docstring.
- `AGENTS.md` (root) and `packages/create-app/AGENTS.md` — record `src/i18n/**` as a mirrored surface.
- PR #5272's body — resolve the `Closes #4738` auto-close problem by filing and referencing the follow-up issue.

## Non-goals

- **The `showQueryTime: false` DataTable switch** requested in #4738. It is an additive `DataTable` API, not a locale fix; it ships as its own issue and its own PR (this run files the issue — that is the point of step 2.4).
- Re-running `yarn template:sync:fix` or touching the five locale dictionaries. They are already byte-identical to `apps/mercato/src/i18n/**` (verified with `cmp` on all five) and the review confirmed the delta independently.
- Wiring `yarn template:sync` into a CI workflow. The review notes it is unwired but does not ask for it, and the strengthened test covers the same ground from inside the suite CI already runs.
- Any change to the i18n gate scripts (`scripts/i18n-check-*`), which deliberately ignore `create-app/template/**`.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The remaining work is exactly the review's four items | @pkarw's `CHANGES_REQUESTED` review (id 4934629922) — three Minor findings plus one Nit, explicitly "all four items are mechanical" | high |
| The user wants the PR unblocked, not re-scoped | The invocation argument: "ten PR nie przeszedł review. Popraw go tak aby przeszedł dalej" | high |
| Finding 1's fix is a byte/hash comparison plus importing `SYNC_FOLDERS` | The review names the house pattern in `template-example-module-parity.test.ts`, which hashes both sides and imports `TEMPLATE_CONTENT_TRANSFORMS` / `TEMPLATE_ONLY_RELATIVE_FILES` from `scripts/template-sync.ts` | high |
| Finding 2's fix belongs in two files | The review names the root `AGENTS.md` Task Router row and `packages/create-app/AGENTS.md` rule 5 + Template Sync Checklist | high |
| A follow-up issue does not already exist | `gh issue list --search "showQueryTime in:title,body" --state all` returns only #4738 itself | high |
| The dictionaries need no further edit | `cmp` reports all five locale pairs byte-identical on this head | high |
| The original fix itself is correct | The review verified every mechanical claim (key deltas per locale, the two dropped keys being dead, zero translations lost, `ko` being wired) and found no blockers or majors | high |

## Assumptions

- **Keeping `Closes #4738` and referencing a filed follow-up is the better of the two remedies the review offers.** The alternative — downgrading to a plain reference — leaves a human to close #4738 manually and risks it lingering; filing the follow-up keeps the unimplemented request tracked *and* lets the merge close the issue it actually fixed. Reversible either way by editing one line of the PR body.
- **`SYNC_FOLDERS` may be exported.** It is a module-private `const` in a repo-local dev script with no published surface, so widening it to an export breaks no contract (`BACKWARD_COMPATIBILITY.md` covers published symbols; this is neither published nor imported outside the repo).
- **Byte-identity is the right assertion, not merely the requested one.** `template-sync` mirrors these files with a plain copy and declares no `TEMPLATE_CONTENT_TRANSFORMS` entry under `i18n/`, so nothing legitimately makes the two sides differ byte-wise. Asserting bytes therefore cannot produce a false failure.
- The key/value diff stays as the human-readable failure message — the review explicitly called its diagnostic quality worth preserving.

## Risks

- **Low.** Every change is a test assertion, a docstring, two instruction files, and a PR-body line. The only executable edit is adding `export` to an existing `const`.
- The root `AGENTS.md` edit must stay inside the 32,768-byte agent instruction budget; `yarn agents:check-budget` is the guard and runs as part of step 2.3.
- Filing a follow-up issue is an outward-facing action on a public repository — deliberate, and it is the remedy the review named.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 `i18n` added to `SYNC_FOLDERS`, the five template locale dictionaries resynced from the app, and `template-i18n-parity.test.ts` added — 8a3abe85b

### Phase 2: Address the CHANGES_REQUESTED review

- [x] 2.1 Finding 1 — assert real byte-identity in `template-i18n-parity.test.ts` and import `SYNC_FOLDERS` from `scripts/template-sync.ts` instead of regex-matching its source — 94bf3db4c
- [x] 2.2 Finding 4 (Nit) — refresh the stale `scripts/template-sync.ts` docstring so it names the `i18n` folder — 94bf3db4c
- [ ] 2.3 Finding 2 — record `src/i18n/**` as a mirrored surface in the root `AGENTS.md` Task Router row and in `packages/create-app/AGENTS.md` (rule 5 + Template Sync Checklist), then re-check the instruction budget
- [ ] 2.4 Finding 3 — file the `showQueryTime` follow-up issue for the one #4738 request left unimplemented and reference it from the PR body

### Phase 3: Verify and hand back for re-review

- [ ] 3.1 Run the full `validation.commands` gate and record the runner
- [ ] 3.2 Run the authoritative code-review pass over the resume delta and post the summary comment
