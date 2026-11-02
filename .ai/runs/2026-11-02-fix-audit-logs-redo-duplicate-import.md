# Execution plan: fix duplicate `resolveTranslations` import in the audit_logs redo route

## Goal

Restore the `main` build by removing the duplicate `resolveTranslations` import from `packages/core/src/modules/audit_logs/api/audit-logs/actions/redo/route.ts`.

## Context

- #8033 (`b91ee610e`, 2026-10-31) added `import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'` at line 9.
- #7439 (`ee520f766`, 2026-11-02T19:15Z) was branched before #8033 and added the same import at line 18. Git merged both without a textual conflict.
- `tsc` rejects the file with `TS2300: Duplicate identifier 'resolveTranslations'` (lines 9 and 18), so the `prepare` job (Build app) of `CI for Main & Release Lines` fails on `main` (run 41516776703) and on every pull request CI run created since then, because PR runs build GitHub's merge commit with current `main` (e.g. run 41512265979 on #7650).
- Jest does not catch it: the transformer transpiles without type checking, and both existing route suites pass on broken `main`.

## Scope

- Delete the second import (line 18, the one added by #7439). Keep the line-9 import from #8033.

## Non-goals

- No behavior change to the redo route.
- No new lint rule for duplicate imports (would be a repo-wide change; out of scope for an unblock fix).

## Implementation Plan

### Phase 1: Remove duplicate import

- 1.1 Remove the duplicate import and verify typecheck plus the redo route tests.

## Risks

- None material: removing an identical duplicate import binding does not change emitted behavior.
- Regression coverage is the existing `tsc` gate (it is what caught this); the two existing redo route suites cover runtime behavior. No new unit test can assert anything the typecheck does not already enforce.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Remove duplicate import

- [ ] 1.1 Remove the duplicate import and verify typecheck plus the redo route tests
