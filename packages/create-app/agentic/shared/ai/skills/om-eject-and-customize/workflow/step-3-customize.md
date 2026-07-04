# Step 3 — Customize & Track

Make your changes inside `src/modules/<module-id>/` only. Prefer safe zones, avoid the dangerous
ones, and log every change so future upgrades stay manageable.

## Safe modification zones

These files can be modified with low risk:

| File/Area | Safe Changes | Risk Level |
|-----------|-------------|------------|
| `backend/*.tsx` | UI layout, field order, page structure | Low |
| `data/validators.ts` | Validation rules, field constraints | Low |
| `api/*/` handlers | Business logic within existing routes | Medium |
| `commands/` | Command execute/undo logic | Medium |
| `entities/` | Adding new columns (with migration) | Medium |
| `subscribers/` | Event handler logic | Low |
| `workers/` | Job processing logic | Low |
| `widgets/` | Widget components | Low |

### Safe modification example: add a column

```typescript
// 1. Add field to entity
@Property({ type: 'varchar', length: 100, nullable: true })
custom_field: string | null = null

// 2. Update validator
export const createSchema = z.object({
  // ... existing fields
  customField: z.string().max(100).optional(),
})

// 3. Generate migration
// yarn db:generate

// 4. Update form fields in backend pages
```

## Dangerous modification zones

These changes have high upgrade risk or can break other modules:

| File/Area | Danger | Why |
|-----------|--------|-----|
| `index.ts` metadata | Changing `name`/`id` | Other modules reference this ID |
| `acl.ts` feature IDs | Renaming features | Feature IDs are stored in DB, referenced by roles |
| `events.ts` event IDs | Renaming events | Other modules subscribe to these event IDs |
| Entity table/column rename | Database references break | FKs in other modules, stored data |
| `di.ts` service names | Renaming DI keys | Other modules resolve by name |
| Removing API routes | External consumers break | Other modules/integrations call these |
| `setup.ts` structure | Changing tenant init | Affects new tenant provisioning |

### Rules for dangerous zones

- **NEVER** rename entity table names or column names — other modules may reference them
- **NEVER** rename event IDs — subscribers in other modules depend on exact IDs
- **NEVER** rename ACL feature IDs — stored in database with role assignments
- **NEVER** remove API routes — other modules or external systems may call them
- **NEVER** rename DI service registration keys — other modules resolve by key name
- Adding is safe; renaming/removing is dangerous

## Tracking customizations

Keep a record of every change made to ejected modules. This is critical for upgrades.

### Create a customization log

Create `.ai/specs/EJECTED-MODULES.md`:

```markdown
# Ejected Module Customizations

## <module_id>

- **Ejected from version**: 0.4.2 (check package.json at time of ejection)
- **Ejected on**: YYYY-MM-DD
- **Reason**: <why UMES was insufficient>

### Changes Made

| Date | File | Change | Reason |
|------|------|--------|--------|
| YYYY-MM-DD | entities/Entity.ts | Added `custom_field` column | Business requirement X |
| YYYY-MM-DD | backend/page.tsx | Modified list columns | UX improvement |
| YYYY-MM-DD | data/validators.ts | Added custom validation rule | Data quality requirement |
```

### After every change

Add a row to the changes table. This makes future upgrades manageable by showing exactly what was
customized.
