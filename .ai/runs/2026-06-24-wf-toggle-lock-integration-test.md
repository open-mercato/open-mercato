# Execution plan — workflow-definition toggle optimistic-lock integration test

Source follow-up: https://github.com/open-mercato/open-mercato/pull/3397#issuecomment-4791481983
Original fix: PR #3397 (fix #3333) — send optimistic-lock header when toggling a
workflow definition's `enabled` state from the list page.

## Goal

Add end-to-end integration coverage for the **workflow-definition list-page enabled
toggle** optimistic-lock path (the exact surface #3333 fixes), which currently has only
a jsdom unit test. Extend the established home `TC-LOCK-OSS-044.spec.ts` with
`WF-TOGGLE-*` cases proving:

1. the *Enabled* badge toggle sends `x-om-ext-optimistic-lock-expected-updated-at` and the write persists;
2. the row-action *Enable/Disable* menu item does the same (and stays on the list);
3. a stale row-action toggle is refused with a 409 and surfaces the unified conflict banner.

## Scope

- `packages/core/src/modules/workflows/__integration__/TC-LOCK-OSS-044.spec.ts` — add the toggle cases.
- Reuse existing helpers only (`workflowsFixtures`, `optimisticLockUi`, `auth`, `api`, `ui`).

## Non-goals

- No production code changes — #3333's fix already shipped; this is coverage only.
- No new shared helpers unless strictly necessary.
- Do not touch the visual editor / CrudForm edit paths (already covered by 044's WF-01).

## Risks

- The *Enabled* badge click also bubbles to the DataTable row-click → navigates to the
  visual editor. Mitigation (per the follow-up's heads-up): capture the PUT + assert its
  header from the network layer and confirm via an API read-back, rather than asserting
  post-click badge text; drive the live conflict-banner case through the **row action**,
  which `stopPropagation`s and stays on the list.
- `admin@acme.com` can 500 under concurrent-login load on this box — single spec / low
  worker count keeps it stable; matches the sibling 044 cases which also use `admin`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Add the integration test

- [x] 1.1 Extend TC-LOCK-OSS-044 with WF-TOGGLE-01 (badge + row-action header-sent happy paths)
- [x] 1.2 Add WF-TOGGLE-02 (stale row-action toggle → 409 → conflict banner)

### Phase 2: Validate

- [x] 2.1 Compile the changed spec (`playwright test --list` parses + type-checks it under the QA tsconfig)
- [x] 2.2 Boot ephemeral env and run TC-LOCK-OSS-044 green (7/7 passed, incl. the 3 new WF-TOGGLE cases)
