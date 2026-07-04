# Extension Issues

## Response Enricher data not appearing

**Checklist**:

1. **Is `data/enrichers.ts` exporting `enrichers` array?**
   ```typescript
   export const enrichers = [enricher]
   ```

2. **Did you run `yarn generate`?** Enrichers are auto-discovered

3. **Is `targetEntity` correct?** Must match the target module's entity ID exactly
   (e.g., `customers.person` not `customers.people`)

4. **Is the enricher throwing silently?** Check `critical: false` (default) — errors are swallowed.
   Temporarily set `critical: true` to surface errors.

5. **Check enricher `id` is unique** — duplicate IDs cause only one to run

## Widget not appearing in target module

**Checklist**:

1. **Is the widget mapped in `injection-table.ts`?**
   ```typescript
   export const widgetInjections = {
     '<spot-id>': { widgetId: '<your-widget-id>', priority: 50 },
   }
   ```

2. **Is the spot ID correct?** Check the exact format:
   - Forms: `crud-form:<entityId>:fields`
   - Tables: `data-table:<tableId>:columns`
   - Menus: `menu:sidebar:main`

3. **Does the widget file export default?**
   ```typescript
   export default widget
   ```

4. **Is the widget `metadata.id` unique?** Duplicate IDs cause conflicts

5. **Did you run `yarn generate`?** Widgets are auto-discovered

## API Interceptor not running

**Checklist**:

1. **Is `api/interceptors.ts` exporting `interceptors` array?**
   ```typescript
   export { interceptors }
   ```

2. **Does `targetRoute` match?** Check exact route path (without `/api/` prefix)

3. **Does `methods` include the HTTP method?** e.g., `['GET', 'POST']`

4. **Is the interceptor throwing instead of returning `{ ok: false }`?**
   Errors in interceptors are caught silently

5. **Check `priority`** — lower priority runs first. Another interceptor may be blocking

## Component replacement not working

**Checklist**:

1. **Is `widgets/components.ts` exporting `componentOverrides`?**
2. **Is the `componentId` handle correct?** Use `ComponentReplacementHandles` helpers
3. **For `replacement` mode**: is `propsSchema` provided?
4. **Did you run `yarn generate`?**
