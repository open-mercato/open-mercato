# Entity & Migration Issues

## "Column does not exist" / "Table does not exist"

**Symptoms**: Database queries fail with missing column/table errors

**Checklist**:

1. **Did you create a migration after adding/changing the entity?**
   ```bash
   yarn db:generate     # Probes/creates migration file
   ```
   Proposed fix: Run `yarn db:generate` to inspect the required migration, then keep only the scoped SQL for your module and update `src/modules/<module_id>/migrations/.snapshot-open-mercato.json`.

2. **Is the entity declared in the right file with the right imports?**
   Entity classes belong in `src/modules/<module_id>/data/entities.ts` and decorators must come from `@mikro-orm/decorators/legacy`.
   Proposed fix: move stale `entities/<Entity>.ts` patterns into `data/entities.ts` and fix the imports before regenerating the migration.

3. **Did you apply the migration?**
   ```bash
   yarn db:migrate      # Applies pending migrations
   ```
   Proposed fix: Run `yarn db:migrate`.

4. **Is the migration file correct?**
   Check `src/modules/<module_id>/migrations/` for the latest migration.
   Verify it has the expected columns and types.
   Proposed fix: If wrong, delete the migration file, fix the entity, and regenerate.

## Migration generation creates unexpected changes

**Symptoms**: `yarn db:generate` produces migrations for unrelated modules

**Checklist**:

1. **Are node_modules up to date?**
   ```bash
   yarn install
   ```

2. **Did you modify a core module entity without ejecting?**
   Never edit `node_modules/@open-mercato/*`.
   Proposed fix: Revert changes to node_modules. Use UMES extensions instead, or eject the module.

3. **Is a module snapshot stale?**
   Check whether the generated SQL recreates a table or column that already has a committed migration.
   Proposed fix: update that module's `migrations/.snapshot-open-mercato.json` to include the already-migrated schema, then re-run `yarn db:generate` and expect `no changes`.

## Entity changes not reflected

**Symptoms**: Changed entity file but API still returns old schema

**Checklist**:

1. Verify the entity lives in `src/modules/<module_id>/data/entities.ts` and imports decorators from `@mikro-orm/decorators/legacy`
2. Run `yarn generate` — entity discovery is cached
3. Run `yarn db:generate` — schema needs a migration
4. Run `yarn db:migrate` — migration needs to be applied
5. Restart `yarn dev` — server caches entity metadata
