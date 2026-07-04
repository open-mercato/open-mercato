# Step 7 — Wire, Verify & Consolidated Rules

## 12. Wire & Verify

### Step 1: Register in modules.ts

Add to `src/modules.ts`:

```typescript
{ id: '<module_id>', from: '@app' },
```

### Step 2: Run Generators

```bash
yarn generate          # Discover module files, update .mercato/generated/
yarn db:generate       # Probe/create migration for the new entity
```

### Step 3: Review Migration

Check the generated migration file in `src/modules/<module_id>/migrations/`. Verify:
- Table name is correct (plural, snake_case)
- All columns present with correct types
- Indexes on `organization_id`, `tenant_id`
- No unexpected changes
- `migrations/.snapshot-open-mercato.json` was updated to the post-change schema
- Unrelated generated migrations were deleted from the diff

### Step 4: Apply & Test

```bash
yarn db:migrate        # Apply migration only after explicit user confirmation
yarn dev               # Start dev server
```

### Step 5: Run Post-Scaffold Validation Gate

After every structural module change, run **in order** before committing:

```bash
# 1. Re-emit generated registries with the new module
yarn generate

# 2. Purge stale structural cache (nav, module-graph fingerprints)
yarn mercato configs cache structural --all-tenants

# 3. Grant ACL features declared in acl.ts to existing roles
yarn mercato auth sync-role-acls

# 4. Type-check all files — catches API mismatches before they reach runtime
yarn typecheck
```

> **Why this matters**: A malformed `events.ts` (for example, using the old keyed-object shape for `createModuleEvents`) will crash `/login` and every other page because generated registries import all active module files at startup. A bad scaffold can make the whole admin inaccessible. Running `yarn typecheck` after `yarn generate` catches this before it ships.

### Step 6: Verify

- [ ] Module appears in admin sidebar (if menu item added)
- [ ] List page loads at `/backend/<module_id>`
- [ ] Create form works at `/backend/<module_id>/<entities>/new`
- [ ] Edit form loads existing record
- [ ] Delete works from list page
- [ ] ACL features appear in role management
- [ ] `/login` still loads after structural changes

### Self-Review Checklist

- [ ] Module ID is plural, snake_case
- [ ] Entity class has `organization_id`, `tenant_id`, standard columns
- [ ] Validators use zod with `z.infer` for types
- [ ] API routes live in `api/<entities>/route.ts` (not `api/get/`, `api/post/`, etc.)
- [ ] `makeCrudRoute` uses `{ metadata, orm, list, create, update, del }` — not `{ entity, entityId, operations, schema }`
- [ ] API route exports `metadata`, named `{ GET, POST, PUT, DELETE }`, and `openApi`
- [ ] `DataTable` receives explicit `data`, `isLoading`, `error`, `pagination` — not `apiPath` or `createHref`
- [ ] `CrudForm` uses `onSubmit` with `createCrud`/`updateCrud` and `onDelete` with `deleteCrud` — not `apiPath`, `mode`, or `resourceId`
- [ ] `events.ts` uses `createModuleEvents({ moduleId, events: [...] })` array shape — not a keyed object
- [ ] `events.ts` has `export default eventsConfig`
- [ ] `acl.ts` exports `features` (named export is sufficient; default export is recommended for broad import compatibility)
- [ ] ACL feature IDs use `<module>.<entity>.view` / `<module>.<entity>.manage` pattern
- [ ] `setup.ts` grants every feature in `acl.ts` to at least `admin` and `superadmin`
- [ ] Sidebar icon uses `lucide-react` component (not inline SVG / `React.createElement`)
- [ ] `page.meta.ts` includes `pageGroup` + `pageGroupKey` for sidebar grouping
- [ ] `page.meta.ts` includes `pageOrder` for sort position
- [ ] All related pages share the same `pageGroupKey`
- [ ] Settings pages (if any) have `pageContext: 'settings' as const` and `navHidden: true`
- [ ] Module registered in `src/modules.ts` with `from: '@app'`
- [ ] Post-scaffold gate run: `yarn generate` → `yarn mercato configs cache structural --all-tenants` → `yarn mercato auth sync-role-acls` → `yarn typecheck`
- [ ] Migration SQL is scoped to this entity and `.snapshot-open-mercato.json` is updated
- [ ] No `any` types
- [ ] No hardcoded user-facing strings
- [ ] No direct ORM relationships to other modules
- [ ] `/login` still loads after all changes

---

## Rules

- **MUST** use plural, snake_case for module ID and folder name
- **MUST** include `organization_id` and `tenant_id` on all tenant-scoped entities
- **MUST** include standard columns (`id`, `created_at`, `updated_at`, `deleted_at`, `is_active`)
- **MUST** validate all inputs with zod schemas in `data/validators.ts`
- **MUST** place all HTTP method handlers in a single `api/<entities>/route.ts` — not separate `api/get/`, `api/post/` files
- **MUST** use `makeCrudRoute` with `{ metadata, orm, list, create, update, del }` — not `{ entity, entityId, operations, schema }`
- **MUST** export `metadata`, named method handlers `{ GET, POST, PUT, DELETE }`, and `openApi` from every route file
- **MUST** use `CrudForm` with explicit `onSubmit` / `onDelete` handlers — not `apiPath`, `mode`, or `resourceId` props
- **MUST** use `DataTable` with explicit `data`, `isLoading`, `error`, `pagination` — not `apiPath`, `createHref`, or `extensionTableId`
- **MUST** use `createModuleEvents({ moduleId, events: [...] })` array shape — NEVER the old keyed-object `{ 'id': { description, payload } }` shape
- **MUST** add `export default eventsConfig` in `events.ts`
- **MUST** export `features` from `acl.ts` (named export is sufficient; adding `export default features` is recommended for broad import compatibility)
- **MUST** use `<module>.<entity>.view` / `<module>.<entity>.manage` feature ID pattern
- **MUST** include `pageGroup` and `pageGroupKey` on list/root backend pages for sidebar grouping
- **MUST** use `as const` on `pageContext` values (e.g., `pageContext: 'settings' as const`)
- **MUST** declare ACL features and wire them in `setup.ts` `defaultRoleFeatures`
- **MUST** register module in `src/modules.ts` with `from: '@app'`
- **MUST** run the post-scaffold validation gate after creating module files: `yarn generate` → `yarn mercato configs cache structural --all-tenants` → `yarn mercato auth sync-role-acls` → `yarn typecheck`
- **MUST** verify `/login` still loads after every structural change
- **MUST** create or keep a scoped migration after creating/modifying entities and update `.snapshot-open-mercato.json`
- **MUST NOT** commit unrelated migrations emitted by `yarn db:generate`
- **MUST NOT** run `yarn db:migrate` without explicit user confirmation
- **MUST NOT** create ORM relationships (`@ManyToOne`, `@OneToMany`) to entities in other modules
- **MUST NOT** edit `.mercato/generated/*` files manually
- **MUST** declare `<module>/encryption.ts` exporting `defaultEncryptionMaps` whenever the entity stores sensitive / GDPR-relevant fields (PII, contact info, addresses, free-text notes about people, integration credentials, secrets) — and read those columns via `findWithDecryption` / `findOneWithDecryption`
- **MUST NOT** hand-roll AES/KMS calls or store "we'll encrypt this later" plaintext for sensitive columns — use the encryption-maps mechanism described in [step-6-optional-features.md](step-6-optional-features.md) → Encryption maps
