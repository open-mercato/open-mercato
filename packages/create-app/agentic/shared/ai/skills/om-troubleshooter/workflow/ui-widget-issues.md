# UI & Widget Issues

## Backend page is blank

**Checklist**:

1. **Does the page have `'use client'` directive?** Required for pages with interactivity
2. **Check browser console for errors** — React rendering errors appear there
3. **Is the correct import path used?** Use `@open-mercato/ui/backend/...`
4. **Are API calls using `apiCall` / `apiCallOrThrow`?** Never use raw `fetch`

## DataTable shows no data or missing rows

**Checklist**:

1. **Is the API path correct?** Check `apiPath` prop matches actual API route
2. **Is the entity ID correct?** Check `entityId` prop
3. **Does the API return data?** Test with `curl` or browser devtools
4. **Does the user have `view` feature?** Check ACL
5. **Are pagination props wired?** Without `page`, `pageSize`, `totalCount`, and `onPageChange`, the table only shows the first page with no pagination controls. Check the API returns `totalCount` in the response.
6. **Is `organization_id` scoping correct?** Records created without proper `organization_id` won't appear when the API filters by current org
7. **Are records soft-deleted?** Records with `deletedAt` set are filtered out by default

## Sidebar icons broken or wrong

**Checklist**:

1. **Are icons using `lucide-react` components?** Import from `lucide-react` (e.g., `import { Trophy } from 'lucide-react'`)
2. **AVOID `React.createElement('svg', ...)`** — inline SVG via `React.createElement` is fragile in bundler contexts and can produce broken icons after `yarn generate`
3. **Is the icon defined in `page.meta.ts`?** Export as part of `metadata.icon`
4. **Did you run `yarn generate`?** The generator reads icon metadata from `page.meta.ts`

**Correct pattern**:
```tsx
// page.meta.ts
import { Trophy } from 'lucide-react'
export const metadata = { icon: <Trophy className="size-4" /> }
```

## CrudForm doesn't save

**Checklist**:

1. **Check browser network tab** — look for the POST/PUT request and response
2. **Is the zod schema matching the form fields?** Mismatched field names cause silent failures
3. **Are required fields filled?** Check form validation
4. **Does the API route handle the HTTP method?** Check `api/<resource>/route.ts` exports a `POST`/`PUT` handler (and lists it in `metadata`)
