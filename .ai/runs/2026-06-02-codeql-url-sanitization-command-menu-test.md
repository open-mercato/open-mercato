# Fix CodeQL `js/incomplete-url-substring-sanitization` alert in command-menu test

## Overview

GitHub Advanced Security (CodeQL) raised one open code-scanning alert against the
`develop` → `main` release PR [#2425](https://github.com/open-mercato/open-mercato/pull/2425):

- **Alert #126** — `js/incomplete-url-substring-sanitization` (security-severity: high, classified `test`)
  - File: `packages/ui/src/primitives/__tests__/command-menu.test.tsx:156`
  - Message: *"'Monday.com' can be anywhere in the URL, and arbitrary hosts may come before or after it."*

### Root cause

The test locates a `CommandMenuItem` by its visible label:

```ts
const monday = Array.from(items).find((el) => el.textContent?.includes('Monday.com')) as HTMLElement
```

CodeQL's `js/incomplete-url-substring-sanitization` heuristic flags any `.includes()`
of a host-like literal (`Monday.com` contains a `.com` TLD) as an incomplete URL host
check that can be bypassed. Here the string is **not** a URL and the check is **not**
security-sensitive — it is a DOM-text match in a unit test that finds the menu item
whose label is `Monday.com`. This is a false positive driven purely by the literal
shape.

### Fix

Match the item's label by exact (trimmed) equality instead of substring containment.
This preserves the test's intent (find the item labeled exactly `Monday.com`), is
actually more precise, and is not a substring/URL check, so the CodeQL heuristic no
longer fires.

## Goal

Clear CodeQL alert #126 without changing test behavior or any product code.

## Scope

- `packages/ui/src/primitives/__tests__/command-menu.test.tsx` — single predicate change.

## Non-goals

- No changes to `CommandMenu` primitive or any product code.
- No suppression/dismissal of the alert via config; fix the flagged pattern at source.
- No changes to other tests or fixtures.

## External References

- None (`--skill-url` not provided).

## Risks

- Minimal. The exact-match predicate could fail if the rendered label carried extra
  whitespace; `.trim()` guards against that. Verified by re-running the UI test suite.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Remediate alert #126

- [x] 1.1 Replace substring `.includes('Monday.com')` with exact trimmed label match — 4218d8e63
- [x] 1.2 Run UI package tests + typecheck to confirm green — 4218d8e63

> Validation notes:
> - `NODE_ENV=test yarn workspace @open-mercato/ui test -- command-menu` → **12 passed, 12 total**.
>   (The janitor shell defaults `NODE_ENV=production`, which makes React load its
>   production bundle without `act`; every render test in the package fails until
>   `NODE_ENV=test` is set — pre-existing and unrelated to this change.)
> - UI typecheck reports only two pre-existing errors in
>   `core/src/generated-shims/entities.ids.generated.ts` (`#generated/*` missing
>   because `yarn generate` has not run in this fresh worktree). No errors in the
>   changed file.

## Changelog

- Opened as PR #2427 against `develop`. Status: complete.
