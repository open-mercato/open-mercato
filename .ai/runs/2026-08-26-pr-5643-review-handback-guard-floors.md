# PR #5643 — review handback: pin real floors on the backend-page route-param guard

**PR:** https://github.com/open-mercato/open-mercato/pull/5643
**Issue:** #5600
**Branch:** `fix/issue-5600-useparams-detail-pages`
**Base:** `develop`
**Status:** complete

## Context

This plan was reconstructed by `om-auto-continue-pr` (adoption): PR #5643 was opened by
`om-auto-fix-issue`, whose run folder never carried a `Tracking plan:` line, so the resume
had no plan to pick up. The goal below is not invented — it is taken verbatim from the
review handback @pkarw posted on `4d74a89fb`
([comment](https://github.com/open-mercato/open-mercato/pull/5643#issuecomment-5423304178)),
which states what flips the review to approve.

## Goal

Land review **minor 1** and dispose of **minor 2**, so `changes-requested` can return to
`review`.

**Minor 1 — the guard's collection floor is hollow.**
`packages/core/src/__tests__/backend-page-route-params.test.ts` asserted
`expect(pages.length).toBeGreaterThan(0)`. The scan has two swallowed filesystem `catch`
blocks (the `readdirSync` guard in `collectBackendPages`, and the `statSync` guard in
`collectModuleRootsUnder`). If either starts swallowing real errors, the scan silently
shrinks — and with a floor of `0`, a scan that found **one** page still reports green while
the `useParams()` guard passes vacuously. The two workspace guards this file says it is
modelled on both pin real floors: `optimistic-lock-ui-coverage-workspace.test.ts:241-242`
pins `> 3` roots and `> 200` candidates; `optimistic-lock-command-coverage.test.ts:133`
pins `> 100` files.

**Minor 2 — three surviving `resolvePathnameId` fallbacks.** Explicitly **out of scope
here** per the reviewer ("this one does not have to land here — filing it as a follow-up
issue and saying so is a fine disposition"). Filed as a follow-up issue and linked on the PR.

## Non-goals

- Re-doing or extending the #5600 page fix itself — the reviewer verified it from source and
  did not dispute it.
- Fixing the three `resolvePathnameId` fallbacks (minor 2) on this branch.
- Nits 3 and 4 from the review body — optional, left for a convenient moment.
- Touching the `needs-qa` gate. `qa-approved` is a maintainer's label; this run does not apply it.

## Assumptions

- The reviewer's suggested `> 200` page floor is the intended number (today's scan finds 277).
- The module-roots floor is left to judgement ("cheap"); `> 10` is used against today's 22 roots.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.
> Do not rename step titles.

### Phase 1: Pin the guard's collection floors

- [x] 1.1 Hoist `moduleRoots` into a named binding so it can be asserted on — e82ae3dac
- [x] 1.2 Replace `expect(pages.length).toBeGreaterThan(0)` with `> 200`, and assert `moduleRoots.length > 10` alongside it — e82ae3dac
- [x] 1.3 Verify the floors actually bite (simulate each swallowed `catch` collapsing; confirm red) — e82ae3dac
- [x] 1.4 Run the validation gate — e82ae3dac

### Phase 2: Dispose of minor 2 and hand back

- [x] 2.1 File the follow-up issue for the three surviving `resolvePathnameId` fallbacks — issue #5656
- [x] 2.2 Link it on the PR and say so in the handback comment
- [x] 2.3 Normalize labels (`changes-requested` → `review`), release the lock

## External references

- Review handback: PR #5643 comment by @pkarw, 2026-08-26T08:58:49Z
- Guards this file is modelled on: `packages/core/src/__tests__/optimistic-lock-ui-coverage-workspace.test.ts`,
  `packages/core/src/__tests__/optimistic-lock-command-coverage.test.ts`
