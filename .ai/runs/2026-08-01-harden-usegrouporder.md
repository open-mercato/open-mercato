# Harden useGroupOrder reorder composition and document the render-time ref guard

- **Issue:** [#4691](https://github.com/open-mercato/open-mercato/issues/4691) — follow-up carrying the three re-review nits from [#4411](https://github.com/open-mercato/open-mercato/pull/4411)
- **Base:** `develop`
- **Branch:** `fix/issue-4691-harden-usegrouporder`
- **Scope:** `packages/ui/src/backend/crud/useGroupOrder.ts` and its unit test file — nothing else

## Goal

Land the three hardening/documentation items that #4411's re-review closed with (0 blockers,
0 majors, 0 minors, 3 nits) and that were deliberately kept out of that PR so a hard-won green
CI run would not be re-rolled. None of the three is a live defect: item 1 is unreachable with the
hook's only current consumer, item 2 is a harmless no-op, item 3 is a documentation gap.

## Constraints

Explicitly out of scope, per the issue's acceptance criteria: the storage key
`om:group-order:<pageType>`, the persisted payload shape, the merge semantics, and the
drag-and-drop UX all stay exactly as they are. The ten existing tests must pass unchanged,
including the #4386 render-loop repro.

## Progress

- [x] Verify on `upstream/develop` that none of the three items landed with #4411 — `reorder`
      still derives `next` from `stableIdsRef.current` without advancing it, the `mergedIds`
      `useMemo` is still keyed on the `defaultGroupIds` array identity, and the JSDoc still
      carries only the #4386 note.
- [x] Add the regression test calling `reorder` twice inside one `act()` with no render in
      between, and confirm it fails against the unmodified production file (received
      `['b','a','c']`, expected `['c','b','a']`).
- [x] Item 1 — advance `stableIdsRef.current` to the reordered array inside `reorder`, before
      persisting, so successive calls in one commit compose instead of overwriting.
- [x] Item 2 — drop the `mergedIds` `useMemo` in favour of a plain render-time computation, so
      the code no longer implies a stabilization that the `arraysEqual` ref guard actually
      provides.
- [x] Item 3 — document in the hook's JSDoc why mutating the ref during render is safe here:
      the guard swaps the reference only on a *content* difference, so a discarded concurrent
      render can leave a different array identity but never a content-stale value.
- [x] Run the full validation gate from `.ai/agentic.config.json` locally and record the two
      pre-existing, environment-level `yarn test` failures that the change cannot touch.
- [x] Open the PR against `develop` with the failing-before/passing-after evidence in the body.

## Validation

Local runner (no compose `app` container was running), commands in the configured order:
`yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`,
`yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`. Everything green
except two failures inside `yarn test` that are unrelated to this diff:

- `open-mercato-docs#test` — the Docusaurus production build exhausts the repo-wide
  `--max-old-space-size=768` cap and aborts with a V8 OOM. Re-run with `4096` it exits `0`.
- `create-mercato-app#test` — `src/lib/agent-harness-evaluator.test.ts` is cancelled for want
  of an OAuth token (`fail 0`, `cancelled 1`).

`@open-mercato/ui` itself reports 212 suites / 1710 tests passing, the `useGroupOrder` suite
going from 10 to 11 tests.
