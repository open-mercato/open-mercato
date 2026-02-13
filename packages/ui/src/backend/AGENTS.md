# Backend UI — Agent Guidelines

Use `@open-mercato/ui/backend` for all admin/backend page components. See `packages/ui/AGENTS.md` for full UI patterns.

## MUST Rules

1. **MUST set stable `id` values on `RowActions` items** — use `edit`, `open`, `delete`, etc. DataTable resolves default row-click behavior from these ids
2. **MUST use `apiCall`/`apiCallOrThrow`** from `@open-mercato/ui/backend/utils/apiCall` — never use raw `fetch`
3. **MUST use `LoadingMessage`/`ErrorMessage`** from `@open-mercato/ui/backend/detail` for loading and error states
4. **MUST NOT hard-code user-facing strings** — use `useT()` for all labels and messages

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
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { CrudForm, createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/crud'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { FormHeader, FormFooter } from '@open-mercato/ui/backend/forms'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
```

## When Building Backend Pages

- Use `CrudForm` for create/edit flows — see `packages/ui/AGENTS.md` → CrudForm Guidelines
- Use `DataTable` for list views — see `packages/ui/AGENTS.md` → DataTable Guidelines
- Use `FormHeader` with mode `edit` (compact) or `detail` (large title with status)
- Follow the customers module as the reference implementation
