# Migration Lifecycle

## 6. Migration Lifecycle

### Creating a Migration

```bash
# 1. Modify src/modules/<module_id>/data/entities.ts
# 2. Probe/generate migration
yarn db:generate

# 3. Review the generated migration or use it as the baseline for scoped manual SQL
# Check src/modules/<module_id>/migrations/Migration_YYYYMMDD_HHMMSS.ts

# 4. Update src/modules/<module_id>/migrations/.snapshot-open-mercato.json
# 5. Apply migration only after explicit user confirmation
yarn db:migrate
```

### Migration Best Practices

1. **Review every migration** — auto-generated doesn't mean correct
2. **Check for unintended changes** — sometimes generators pick up unrelated diffs
3. **Do not commit unrelated generated migrations** — delete them from the diff
4. **Scoped manual SQL is allowed** when generator churn is unrelated, but the migration and `.snapshot-open-mercato.json` must still describe the same post-change schema
5. **Update `.snapshot-open-mercato.json`** — it is the baseline that prevents duplicate future migrations
6. **New columns should have defaults** — prevents breaking existing rows
7. **Never rename columns** — add new column, migrate data, remove old column (across releases)
8. **Never drop tables** — soft delete or archive first

### Adding a Column to Existing Entity

```typescript
// Add to entity with a default value
@Property({ type: 'varchar', length: 100, default: '' })
new_field: string = ''

// Or nullable for optional fields
@Property({ type: 'varchar', length: 100, nullable: true })
new_field: string | null = null
```

Then:
```bash
yarn db:generate   # Probes/creates ALTER TABLE ADD COLUMN migration
yarn db:migrate    # Applies it only after explicit user confirmation
```

### Removing a Column

Don't remove columns in a single step. Instead:

1. Stop writing to the column (remove from validators and forms)
2. Make the column nullable if it isn't already
3. In a later release, drop the column via migration
