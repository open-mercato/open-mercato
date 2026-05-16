# Champion CRM Module

- Keep this module app-local under `apps/mercato/src/modules/champion_crm`.
- Do not introduce runtime dependencies on `@open-mercato/core/modules/customers`; core customers is a reference pattern only.
- Keep AI integrations behind the optional adapter type in `ai/adapter.ts`; do not import providers from the module root.
- Prefer server-rendered backend shells and small client islands only when interaction is required.
- Preserve tenant and organization scoping on every query and write.

