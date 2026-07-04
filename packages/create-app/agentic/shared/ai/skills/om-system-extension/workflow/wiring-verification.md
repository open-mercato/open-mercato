# Wiring & Verification

## File Checklist

After implementing an extension, verify all files exist:

| File | Required When |
|------|--------------|
| `data/enrichers.ts` | Adding data to another module's API response |
| `widgets/injection/<name>/widget.ts` | Adding UI elements (fields, columns, actions, menus) |
| `widgets/injection-table.ts` | Mapping widgets to target spots |
| `widgets/components.ts` | Replacing/wrapping UI components |
| `api/interceptors.ts` | Intercepting API routes |
| `data/guards.ts` | Blocking/validating mutations |
| `subscribers/<name>.ts` | Reacting to domain events |

## Post-Implementation Steps

1. **Run `yarn generate`** — registers new enrichers, widgets, interceptors, guards
2. **Run `yarn dev`** — verify extension appears in target module UI
3. **Check browser console** — look for warnings about invalid spot IDs or missing enrichers
4. **Test the full flow** — create/edit/delete in the target module, verify your extension works

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Missing `enrichMany` | Slow list pages, N+1 queries | Implement batch enrichment with `$in` query |
| Wrong spot ID | Widget doesn't appear | Check exact spot ID format in target module |
| Missing `yarn generate` | Extension not discovered | Run `yarn generate` after adding files |
| Hardcoded strings | i18n warnings | Use `labelKey` / i18n keys everywhere |
| Missing `features` | Extension visible to all users | Add ACL `features` array |
| `onSave` not idempotent | Duplicate records on retry | Use upsert pattern (check-then-create-or-update) |
| `sortable: true` on enriched column | Sort doesn't work | Set `sortable: false` for enriched-only fields |
| Throw in interceptor | 500 error | Return `{ ok: false, message }` instead |
| Missing injection-table entry | Widget exists but not rendered | Add mapping in `injection-table.ts` |

## Rules

- **MUST** run `yarn generate` after adding any extension file
- **MUST** use i18n keys for all user-facing strings
- **MUST** implement `enrichMany` when creating Response Enrichers
- **MUST** namespace enriched fields under `_<your-module>` prefix
- **MUST** make `onSave` endpoints idempotent
- **MUST** use `{ ok: false, message }` pattern instead of throwing errors in interceptors/guards
- **MUST** set `sortable: false` on columns backed by enriched data only
- **MUST NOT** modify existing fields in enrichers — additive only
- **MUST NOT** directly import entities from other modules — use EntityManager queries
- **MUST NOT** use wildcard interceptor routes unless absolutely necessary
- Prefer Response Enrichers over API Interceptor `after` hooks for adding data to responses
- Prefer Mutation Guards over sync before-event subscribers for blocking mutations
- When extending UI and data together, always follow the Triad Pattern (enricher → widget → injection-table)
