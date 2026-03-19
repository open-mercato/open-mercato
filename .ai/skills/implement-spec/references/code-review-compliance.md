# Code-Review Compliance Quick Reference

This is a condensed reference of the most common violations to check during implementation. For the full checklist, see `.ai/skills/code-review/references/review-checklist.md`.

## Critical (Must Fix — Blocks Merge)

| # | Check | How to Fix |
|---|-------|-----------|
| 1 | No direct ORM relationships between modules | Use FK IDs, fetch separately |
| 2 | All queries filter by `organization_id` + `tenant_id` | Add tenant scoping to every query |
| 3 | `findWithDecryption` used (not raw `em.find`) | Replace with decryption helpers |
| 4 | All inputs validated with zod | Add zod schemas in `data/validators.ts` |
| 5 | API routes export `openApi` + `metadata` with guards | Add exports |
| 6 | No backward compatibility violations | Follow deprecation protocol |
| 7 | No event/spot IDs renamed or removed | Keep existing IDs, add new ones additively |

## High (Must Fix)

| # | Check |
|---|-------|
| 1 | Subscribers/workers export `metadata` |
| 2 | No raw `fetch` — use `apiCall`/`apiCallOrThrow` |
| 3 | No `any` types — use zod + `z.infer` |
| 4 | Changed behavior has test coverage |
| 5 | Commands are undoable with snapshots |
| 6 | `extractUndoPayload()` from shared (no duplication) |

## Medium (Should Fix)

| # | Check |
|---|-------|
| 1 | `CrudForm` for forms, `DataTable` for tables |
| 2 | `flash()` for feedback (not `alert()`) |
| 3 | No hardcoded user-facing strings — use i18n |
| 4 | Boolean parsing via `parseBooleanToken`/`parseBooleanWithDefault` |
| 5 | No hand-written migrations |
| 6 | `LoadingMessage`/`ErrorMessage` for states |

## Anti-Pattern Quick Scan

Before marking a phase done, scan for these patterns in your diff:

```
grep -rn "any" --include="*.ts" --include="*.tsx"     # No `any` types
grep -rn "fetch(" --include="*.ts" --include="*.tsx"   # No raw fetch
grep -rn "em\.find\b" --include="*.ts"                 # Should be findWithDecryption
grep -rn "alert(" --include="*.tsx"                     # Should be flash()
grep -rn "<button" --include="*.tsx"                    # Should be Button/IconButton
```
