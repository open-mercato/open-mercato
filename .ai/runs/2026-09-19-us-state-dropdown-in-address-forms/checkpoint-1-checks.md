# Checkpoint 1 - Phase 1 closed (Steps 1.1 to 1.4)

**When:** 2026-09-19, after `c07dfc98d`
**Runner:** local (`yarn <script>`) - no compose `app` container is running in this worktree
**Steps covered:** 1.1, 1.2, 1.3, 1.4

## Targeted validation

| Command | Result |
|---|---|
| `yarn workspace @open-mercato/shared test` | pass - 211 suites, 2435 tests (5 skipped) |
| `yarn workspace @open-mercato/ui test` | pass - 255 suites, 2179 tests |
| `yarn workspace @open-mercato/core test -- AddressEditor` | pass - 2 suites, 17 tests |
| `yarn build:packages --cache-dir=/srv/om/cache/turbo` | pass - 38 tasks |
| `yarn typecheck` | pass - 38 tasks |

## What the new coverage pins

- `packages/shared/src/lib/location/__tests__/subdivisions.test.ts` (new, 11 tests): 51 selectable rows for US,
  DC present, `PR` absent from the picker while `isValidSubdivision('US','PR')` stays true, `findSubdivision` by code,
  by name, lowercase, padded, multi-word, unknown value, unknown country, blank input, and code-before-name precedence
  (`IN` is Indiana's code, not a prefix of a name match).
- `packages/shared/src/lib/display/__tests__/display.test.ts` (extended): no profile plus `{ country: 'US' }` gives 51
  rows; a `us` profile plus `{ country: 'CA' }` gives none; a blank or absent country keeps today's profile-keyed rule;
  `validateAddressForProfile` accepts `Texas`, `texas` and `PR`, and still flags `Mazowieckie`.
- Both `AddressEditor.subdivisions.test.tsx` files (new, 9 tests each): the picker appears for a US address with no
  market profile at all, the territories are absent from it, a non-US country renders the text input, a US-market
  merchant gets a text field for a Canadian address, `Texas` / `texas` / `TX` all preselect Texas, an unknown value
  keeps the warning badge, a pick writes the two-letter code, and neither the preselect nor the badge calls `onChange`.

## Behavior change recorded deliberately

`resolveAddressLayout(profile)` with no options now returns 51 rows for a `us` profile instead of 56 - the five
territories left the picker (spec invariant 6, decision D2). The existing assertion in `display.test.ts` was updated to
51 with a comment saying why. `isValidSubdivision` is untouched and still accepts all 56 codes, so no stored value
starts warning.

## UI / browser checks

Not run at this checkpoint. The dev runtime is up (slot 2, port 3120) but the four screens are exercised together by the
integration tests in Steps 2.3 and 2.4 and by the QA pass on the finished PR; running a browser pass against a
half-finished Phase 2 would prove nothing that those do not.
