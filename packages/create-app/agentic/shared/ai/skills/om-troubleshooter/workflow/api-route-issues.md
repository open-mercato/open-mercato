# API Route Issues

## Route returns 404

**Checklist**:

1. **Is the file in the correct path?**
   `src/modules/<module_id>/api/<resource>/route.ts` — all HTTP methods live in a single `route.ts`. Use path-based folders (`<resource>/`, `<resource>/[id]/`), never per-method `get/`/`post/`/`put/`/`delete/` folders.

2. **Does it export per-method handlers plus `metadata`?**
   ```typescript
   export const metadata = {
     GET: { requireAuth: true, requireFeatures: ['<module_id>.view'] },
     POST: { requireAuth: true, requireFeatures: ['<module_id>.manage'] },
   }
   export async function GET(req: Request) { /* ... */ }
   export async function POST(req: Request) { /* ... */ }
   ```

3. **Does it export `openApi`?**
   ```typescript
   export const openApi = { summary: '...', tags: ['...'] }
   ```
   API routes without `openApi` export are not discovered.

4. **Did you run `yarn generate`?**

## Route returns 500

**Checklist**:

1. **Check server logs** — look for the actual error message
2. **Is the entity imported correctly?** Verify import path
3. **Is `organization_id` filtering applied?** Required for all tenant-scoped queries
4. **Is the zod schema matching the request body?** Schema validation errors return 422, not 500

## Route returns 401 / 403

**Checklist**:

1. **Is the user authenticated?** Check session/token
2. **Does the user have required features?** Check `acl.ts` + `setup.ts` role mapping
3. **Are features assigned to the user's role?** Check role configuration in admin
