# Module Issues

## Module not found / not loading

**Symptoms**: 404 on module routes, module not in sidebar, "module not registered" errors

**Checklist**:

1. **Is the module registered in `src/modules.ts`?**
   ```typescript
   // Must have this entry:
   { id: '<module_id>', from: '@app' }
   ```
   Proposed fix: Add the entry and run `yarn generate`.

2. **Did you run `yarn generate`?**
   Check if `.mercato/generated/` contains your module's entries.
   Proposed fix: Run `yarn generate`.

3. **Is the module folder named correctly?**
   Must be plural, snake_case: `src/modules/<module_id>/`
   Proposed fix: Rename folder to match module ID.

4. **Does `index.ts` export `metadata`?**
   ```typescript
   export const metadata: ModuleInfo = { name: '<module_id>', ... }
   ```
   Proposed fix: Add the metadata export.

5. **Is the dev server running with latest changes?**
   Proposed fix: Restart with `yarn dev`.

## Module loads but pages 404

**Symptoms**: Module appears in generated files but backend pages return 404

**Checklist**:

1. **Are backend page files in the right location?**
   - List page: `backend/page.tsx` (not `backend/index.tsx`)
   - Detail page: `backend/<entities>/[id].tsx` (bracket notation)
   Proposed fix: Rename to match auto-discovery convention.

2. **Do pages export `metadata` with `requireAuth`?**
   ```typescript
   export const metadata = { requireAuth: true, requireFeatures: ['<module_id>.view'] }
   ```
   Proposed fix: Add metadata export.

3. **Does the user have the required ACL features?**
   Check `setup.ts` has `defaultRoleFeatures` for the user's role.
   Proposed fix: Add features to role defaults, re-run setup.
