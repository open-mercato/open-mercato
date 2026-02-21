# Backend UI — Agent Guidelines

Use `@open-mercato/ui/backend` for all admin/backend page components. See `packages/ui/AGENTS.md` for full UI patterns.

## MUST Rules

1. **MUST set stable `id` values on `RowActions` items** — use `edit`, `open`, `delete`, etc. DataTable resolves default row-click behavior from these ids
2. **MUST use `apiCall`/`apiCallOrThrow`** from `@open-mercato/ui/backend/utils/apiCall` — never use raw `fetch`
3. **MUST use `LoadingMessage`/`ErrorMessage`** from `@open-mercato/ui/backend/detail` for loading and error states
4. **MUST NOT hard-code user-facing strings** — use `useT()` for all labels and messages
5. **MUST use global mutation injection when not using `CrudForm`** — call `useInjectionSpotEvents(GLOBAL_MUTATION_INJECTION_SPOT_ID)`, pass `onBeforeSave/onAfterSave`, apply `requestHeaders` with `withScopedApiRequestHeaders`, and emit `dispatchBackendMutationError` on failures
5. **MUST use `Button` or `IconButton`** for every interactive button — never use raw `<button>` elements. Use `IconButton` for icon-only buttons, `Button` for everything else. Always pass `type="button"` explicitly on non-submit buttons. See `packages/ui/AGENTS.md` → Button and IconButton Usage for full patterns and variant reference.

## DataTable Row-Click Behavior

Customize which action ids trigger row clicks via the `rowClickActionIds` prop (defaults to `['edit', 'open']`).

```typescript
<DataTable
  rowClickActionIds={['edit', 'open']}  // Default — clicks trigger edit or open action
  // ...
/>
```

## Key Imports

```typescript
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { CrudForm, createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/crud'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { FormHeader, FormFooter } from '@open-mercato/ui/backend/forms'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useInjectionSpotEvents } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { GLOBAL_MUTATION_INJECTION_SPOT_ID, dispatchBackendMutationError } from '@open-mercato/ui/backend/injection/mutationEvents'
```

## When Building Backend Pages

- Use `CrudForm` for create/edit flows — see `packages/ui/AGENTS.md` → CrudForm Guidelines
- Use `DataTable` for list views — see `packages/ui/AGENTS.md` → DataTable Guidelines
- Use `FormHeader` with mode `edit` (compact) or `detail` (large title with status)
- Follow the customers module as the reference implementation
