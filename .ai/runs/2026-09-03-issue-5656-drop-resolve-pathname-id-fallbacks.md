# Execution plan — drop the surviving `resolvePathnameId` route-id fallbacks (adopted from PR #5664)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-09-03 because PR #5664 carried no execution plan.
**PR:** #5664 · **Branch:** `fix/issue-5656-drop-resolve-pathname-id-fallbacks` · **Base:** `develop`
**Author:** @adeptofvoltron — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Remove the unreachable `resolvePathnameId(pathname)` positional route-id fallback (and its
`resolveCurrent<X>Id()` re-derivation callback) from the three backend detail pages that still
carry it, so each page takes its record id from the `params` prop alone — satisfying every
acceptance box in issue #5656 and matching the pattern PR #5643 established on the webhooks page.

## Scope

- `packages/core/src/modules/integrations/backend/integrations/[id]/page.tsx`
- `packages/core/src/modules/integrations/backend/integrations/bundle/[id]/page.tsx`
- `packages/core/src/modules/data_sync/backend/data-sync/runs/[id]/page.tsx`
- The route-id resolution tests co-located with those three pages.

## Non-goals

- **Extending `packages/core/src/__tests__/backend-page-route-params.test.ts` to reject
  `usePathname()`-derived route ids.** Issue #5656 raises this under "Proposed change" as a
  *"Consider"* with an explicit caveat that it "needs care" because `usePathname()` has legitimate
  non-id uses in backend pages (active-nav highlighting), so the guard would have to key on the
  derivation rather than the hook. It is not one of the issue's Acceptance boxes, and PR #5664's
  own description does not claim it. It belongs in its own PR against its own issue.
- Touching any backend page beyond the three the issue enumerates.
- Changing the reachable id-resolution behavior. This is a dead-code removal; `params?.id` was
  already the value every reachable path used.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The goal is deleting `resolvePathnameId` + `resolveCurrent<X>Id` from exactly three named pages | Issue #5656 "Sites" table and "Proposed change" bullets; PR #5664 body "🎯 Goal" | high |
| Acceptance is four boxes: no residual positional pathname id parsing under `packages/*/src/modules/**/backend/**`, a prop-id test per page, a translated not-found/error state on a missing id, and a green validation gate | Issue #5656 "Acceptance" checklist | high |
| The code change itself is already complete on this branch | Commit `64f0542a` (573-line diff across the 3 pages + 3 test files) verified against the acceptance boxes | high |
| The guard extension is deliberately out of scope | Issue #5656 wording ("Consider", "This needs care"); absent from the Acceptance checklist and from the PR body | high |
| The remaining work is the pipeline's own closeout, not more code | PR #5664 has no reviews and no inline review comments; the only unmet acceptance box is the full validation gate | high |
| The previous automation pass died mid-run | `om-auto-review-pr` claim comment 2026-09-02T12:29:17Z with no verdict comment and no review on the PR | high |

## Assumptions

- **The prop-only narrowing of `params.id` from `string | string[]` to `string` is safe.** The
  backend catch-all host (`apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx`) renders
  `<Component params={match.params} />`, and `matchRoutePattern` only produces an array value for
  a catch-all (`[...x]`) segment — a `[id]` segment always yields a string. If this is wrong, the
  fix is to restore the two-line `resolveRouteId` normalizer, not the pathname heuristic.
- **The branch should be brought up to date with `develop` before the gate runs.** It is 120
  commits behind, so a gate run on the current base proves little about the merge result. None of
  the six touched files changed on `develop` since the merge base, so this is expected to be a
  clean, no-conflict merge. Chose a merge over a rebase because the skill forbids rewriting the
  PR branch's history.
- **No manual QA is needed beyond the existing `needs-qa` label.** The change is a dead-code
  removal on three `.tsx` pages with no reachable behavior change; the label stays because the
  files are UI-rendering, per the repo's automated-verification exemption rules.

## Risks

- Low. The removed code was unreachable, and the reachable path (`params?.id`) is unchanged.
- The one real risk is the `string | string[]` narrowing above; it is covered by the assumption
  and by the three new route-id resolution tests.
- Merging 120 commits of `develop` widens the local gate's surface: unrelated pre-existing test
  failures may appear and must be distinguished from regressions introduced here.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Remove `resolvePathnameId`/`resolveRouteId`/`resolveCurrent<X>Id` and `usePathname()` from the integrations, integrations bundle, and data_sync run detail pages; narrow each `params` type to `id?: string`; add route-id resolution tests for all three — 64f0542a

### Phase 2: Close out the issue's acceptance criteria

- [x] 2.1 Verify no `resolvePathnameId` or equivalent positional pathname id parsing remains under `packages/*/src/modules/**/backend/**` — 64f0542a (verification only, no code change needed)
- [x] 2.2 Verify each of the three pages resolves a missing id into its translated not-found/error state rather than an endless spinner, and that a test covers it — 64f0542a (verification only, no code change needed)
- [x] 2.3 Merge `origin/develop` into the PR branch so the validation gate and CI reflect the real merge target — b03b1357

### Phase 3: Validation and review

- [ ] 3.1 Run the full `validation.commands` gate green
- [ ] 3.2 Run the authoritative `om-auto-review-pr --autofix` pass and land any resulting fixes
