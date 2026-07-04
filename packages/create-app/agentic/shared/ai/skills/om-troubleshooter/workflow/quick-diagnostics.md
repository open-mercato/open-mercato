# Quick Diagnostics

## The "Fix Everything" Sequence

When nothing else works, run this full reset sequence:

```bash
yarn generate          # 1. Regenerate all discovery files
yarn typecheck         # 2. Check for type errors
yarn db:generate       # 3. Check for pending migrations
yarn db:migrate        # 4. Apply any pending migrations
yarn dev               # 5. Restart dev server
```

## Common Error → Fix Table

| Error Message | Likely Cause | Fix |
|--------------|-------------|-----|
| `Module '<id>' not found` | Not in `src/modules.ts` | Add entry, `yarn generate` |
| `Table '<name>' does not exist` | Missing migration | `yarn db:generate` + `yarn db:migrate` |
| `Column '<name>' does not exist` | Entity changed without migration | `yarn db:generate` + `yarn db:migrate` |
| `Cannot find module '@open-mercato/...'` | Package not installed | `yarn install` |
| `Route not found` / 404 | Missing `openApi` export or wrong path | Add export, `yarn generate` |
| `401 Unauthorized` | Missing auth or session expired | Check login, check `requireAuth` |
| `403 Forbidden` | User lacks required feature | Check `acl.ts` + `setup.ts` roles |
| `422 Unprocessable Entity` | Zod validation failed | Check request body matches schema |
| Widget not showing | Missing `injection-table.ts` mapping | Add mapping, `yarn generate` |
| Enricher data missing | `critical: false` hiding errors | Set `critical: true` temporarily |
| Interceptor not running | Wrong `targetRoute` or `methods` | Check exact route path and methods |
| `ECONNREFUSED` | Database/service not running | `docker compose up -d` |
| DataTable shows fewer rows than expected | Missing pagination props or API `totalCount` | Wire `page`/`pageSize`/`totalCount`/`onPageChange` props |
| Sidebar icons broken or wrong | Inline SVG via `React.createElement` | Use `lucide-react` components in `page.meta.ts` |
| `yarn generate` changes unexpected files | Stale generated files | Delete `.mercato/generated/`, re-run |
