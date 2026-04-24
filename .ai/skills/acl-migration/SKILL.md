---
name: acl-migration
description: Generate an idempotent database migration that renames ACL feature IDs in role_acls and user_acls when acl.ts IDs change. Use when renaming feature IDs, refactoring module names, or responding to a review that flags missing ACL migrations.
---

# ACL Migration Skill

Generates a safe, idempotent MikroORM migration that renames ACL feature IDs
stored in `role_acls.features_json` and `user_acls.features_json`.

## When to Use

- You renamed one or more `id` values in an `acl.ts` file
- A code review flags missing DB migration for renamed ACL IDs
- A module is being reorganised and its feature IDs need to follow the new naming convention

## Steps

### 1. Collect the Rename Map

Read every `acl.ts` file touched by the current change. Build a table:

| Old ID | New ID |
|--------|--------|
| `module.old_entity.action` | `module.new_entity.action` |

Also include wildcard variants for each renamed prefix:

| Old wildcard | New wildcard |
|---|---|
| `module.old_entity.*` | `module.new_entity.*` |

Wildcards matter because `setup.ts defaultRoleFeatures` entries like `['catalog.*']`
or `['customers.people.*']` may have been written to the database by
`ensureDefaultRoleAcls()`.

### 2. Identify the Target Migration Module

Put the migration in the module that **owns** the `role_acls` / `user_acls` tables.
In open-mercato that is `packages/core/src/modules/auth/migrations/`.

If the rename only affects a single module's own feature-toggle config keys
(not `role_acls`/`user_acls`), put the migration in that module's `migrations/` folder.

### 3. Choose a Timestamp

The filename must sort AFTER the latest existing migration in the target folder.
Use the current UTC datetime: `Migration<YYYYMMDDHHMMSS>.ts`.

### 4. Write the Migration

Use the pattern below. Key properties:
- **Idempotent**: the `WHERE features_json ? old_val` guard prevents double-apply.
- **No data loss**: only rows containing the old value are updated.
- **Wildcard-safe**: include `*`-suffixed variants in the rename array.
- **Reversible**: `down()` applies the inverse mapping.

```typescript
import { Migration } from '@mikro-orm/migrations';

export class Migration<TIMESTAMP> extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      DO $$
      DECLARE
        old_val text;
        new_val text;
        renames text[][] := ARRAY[
          -- exact IDs
          ARRAY['module.old_entity.action', 'module.new_entity.action'],
          -- wildcard variants
          ARRAY['module.old_entity.*',      'module.new_entity.*']
        ];
        pair text[];
      BEGIN
        FOREACH pair SLICE 1 IN ARRAY renames LOOP
          old_val := pair[1];
          new_val := pair[2];

          UPDATE role_acls
          SET
            features_json = (
              SELECT jsonb_agg(
                CASE WHEN elem = to_jsonb(old_val) THEN to_jsonb(new_val) ELSE elem END
              )
              FROM jsonb_array_elements(features_json) AS elem
            ),
            updated_at = now()
          WHERE deleted_at IS NULL
            AND features_json IS NOT NULL
            AND jsonb_typeof(features_json) = 'array'
            AND features_json ? old_val;

          UPDATE user_acls
          SET
            features_json = (
              SELECT jsonb_agg(
                CASE WHEN elem = to_jsonb(old_val) THEN to_jsonb(new_val) ELSE elem END
              )
              FROM jsonb_array_elements(features_json) AS elem
            ),
            updated_at = now()
          WHERE deleted_at IS NULL
            AND features_json IS NOT NULL
            AND jsonb_typeof(features_json) = 'array'
            AND features_json ? old_val;

        END LOOP;
      END $$;
    `);
  }

  override async down(): Promise<void> {
    // Paste the same block with old/new swapped
    this.addSql(`...`);
  }

}
```

### 5. Document in UPGRADE_NOTES.md

Add or update the entry in `UPGRADE_NOTES.md` at the repo root:
- List every old → new ID pair
- Note the migration file name
- Include action items for third-party module authors

### 6. Update All Reference Files

Grep the repo for old IDs and update every non-generated file that references them:

```bash
grep -r "old.entity.action" --include="*.ts" --include="*.md" -l .
```

Files to update (skip `.git`, `node_modules`, generated files in `.mercato/generated/`):
- `acl.ts` — already done (triggered this skill)
- `setup.ts defaultRoleFeatures` — already done (triggered this skill)
- Backend page `metadata.requireFeatures` — update in-place
- `README.md`, `AGENTS.md` inside the module — update examples
- Spec files in `.ai/specs/` — update feature ID references
- Test files — update assertions that check feature IDs

### 7. Verify

```bash
yarn build:packages   # no TypeScript errors
yarn test             # unit tests pass
```

## Convention Reference

ACL feature IDs follow the pattern: `<module>.<entity_singular>.<action>`

| Segment | Convention | Examples |
|---------|------------|---------|
| module  | plural snake_case folder name | `customers`, `sales`, `catalog` |
| entity  | **singular** snake_case | `person`, `order`, `credit_memo` |
| action  | verb describing the permission | `view`, `manage`, `create`, `approve` |

Do **not** use hyphens in new entity segments. The existing `sales.credit-memo.*`
is a legacy exception.

## Common Mistakes

- Forgetting wildcard variants (`module.entity.*`) — the `ensureDefaultRoleAcls`
  seed writes these into the DB.
- Putting the migration in the wrong module folder — it must be in the module
  that owns `role_acls` / `user_acls` (the `auth` module).
- Modifying an already-merged migration file — always create a new file with a
  later timestamp; never edit a migration that may already have been applied.
- Missing `down()` — always provide the reverse mapping so rollback works.
