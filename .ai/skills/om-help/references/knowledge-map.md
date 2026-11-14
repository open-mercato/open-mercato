# Knowledge map — Open Mercato

Shortcut from a how-to topic to the guide to read first. The root `AGENTS.md` Task Router stays authoritative; when they disagree, follow the Task Router and report the drift.

| Question topic | Read first |
|---|---|
| New module, scaffolding, auto-discovery | `packages/core/AGENTS.md` |
| CRUD routes, OpenAPI, `makeCrudRoute` | `packages/core/AGENTS.md` → API Routes |
| Events, subscribers, `createModuleEvents` | `packages/core/AGENTS.md` → Events |
| RBAC, ACL features, `acl.ts` | `packages/core/AGENTS.md` → Access Control |
| Custom fields, `cf.*`, `defineLink` | `packages/core/AGENTS.md` → Custom Fields |
| Search, `search.ts`, reindexing | `packages/search/AGENTS.md` |
| UI components, forms, `CrudForm`, `DataTable` | `packages/ui/AGENTS.md` |
| Backend pages, `apiCall`, `RowActions` | `packages/ui/src/backend/AGENTS.md` |
| i18n, `useT`, `resolveTranslations` | `packages/shared/AGENTS.md` |
| Cache, tag invalidation | `packages/cache/AGENTS.md` |
| Background workers, queues | `packages/queue/AGENTS.md` |
| Event bus, subscribers | `packages/events/AGENTS.md` |
| AI agents, MCP tools | `packages/ai-assistant/AGENTS.md` |
| Integration providers | `packages/core/src/modules/integrations/AGENTS.md` |
| Customer portal, portal auth | `packages/ui/AGENTS.md` → Portal Extension |
| Webhooks | `packages/webhooks/AGENTS.md` |
| Notifications | `packages/core/AGENTS.md` → Notifications |
| Widget injection, component replacement | `packages/core/AGENTS.md` → Widget Injection |
| Database migrations, `db:generate` | `packages/cli/AGENTS.md` |
