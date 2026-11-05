# K. Module Scaffold & Contributor Guardrails

> Page templates (List, Detail, Form), anti-patterns, scaffold script, scaffolding checklist.

---

### K.1 Page Templates

Three templates cover ~95% of pages in the system. Each uses exclusively design system components.

#### K.1.1 List Page Template

```tsx
// backend/<module>/page.tsx — list page template
'use client'

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, type ColumnDef } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function ListPage() {
  const t = useT()
  const { confirm } = useConfirmDialog()
  const [rows, setRows] = useState<YourEntity[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 0 })
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    apiCall(`/api/your-module?page=${pagination.page}&pageSize=${pagination.pageSize}&search=${search}`)
      .then((res) => {
        if (cancelled) return
        if (res.ok) {
          setRows(res.result.data)
          setPagination((prev) => ({ ...prev, total: res.result.total, totalPages: res.result.totalPages }))
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [pagination.page, pagination.pageSize, search])

  const columns: ColumnDef<YourEntity>[] = [
    { accessorKey: 'name', header: t('module.name', 'Name') },
    {
      accessorKey: 'status',
      header: t('module.status', 'Status'),
      cell: ({ row }) => (
        <StatusBadge variant={mapStatusToVariant(row.original.status)}>
          {t(`module.status.${row.original.status}`, row.original.status)}
        </StatusBadge>
      ),
    },
  ]

  // REQUIRED: EmptyState when there is no data (do not rely on an empty table)
  if (!isLoading && rows.length === 0 && !search) {
    return (
      <Page>
        <PageBody>
          <EmptyState
            title={t('module.empty.title', 'No items yet')}
            description={t('module.empty.description', 'Create your first item to get started.')}
            action={{ label: t('module.create', 'Create item'), onClick: () => router.push('create') }}
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <DataTable
          columns={columns}
          data={rows}
          isLoading={isLoading}
          pagination={pagination}
          onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
          searchValue={search}
          onSearchChange={setSearch}
          headerActions={
            <Button size="sm" onClick={() => router.push('create')}>
              <Plus className="mr-2 h-4 w-4" />
              {t('module.create', 'Create')}
            </Button>
          }
        />
      </PageBody>
    </Page>
  )
}

// Metadata — required for RBAC and breadcrumbs
export const metadata = {
  title: 'module.list.title',
  requireAuth: true,
  requireFeatures: ['module.view'],
  breadcrumb: [{ labelKey: 'module.list.title', label: 'Items' }],
}
```

#### K.1.2 Create Page Template

```tsx
// backend/<module>/create/page.tsx — create page template
'use client'

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { useRouter } from 'next/navigation'

export default function CreatePage() {
  const t = useT()
  const router = useRouter()

  const fields: CrudField[] = [
    { id: 'name', label: t('module.name', 'Name'), type: 'text', required: true },
    { id: 'status', label: t('module.status', 'Status'), type: 'select', options: STATUS_OPTIONS },
    { id: 'description', label: t('module.description', 'Description'), type: 'textarea' },
  ]

  const handleSubmit = async (values: Record<string, unknown>) => {
    const customFields = collectCustomFieldValues(values)
    const result = await createCrud('/api/your-module', { ...values, customFields })
    if (!result.ok) {
      throw createCrudFormError(
        t('module.create.error', 'Failed to create item'),
        result.errors,
      )
    }
    flash(t('module.create.success', 'Item created'), 'success')
    router.push(`/backend/your-module/${result.result.id}`)
  }

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('module.create.title', 'Create item')}
          fields={fields}
          entityIds={['your_entity']}  {/* <- custom fields */}
          onSubmit={handleSubmit}
          backHref="/backend/your-module"
          cancelHref="/backend/your-module"
          submitLabel={t('common.create', 'Create')}
        />
      </PageBody>
    </Page>
  )
}

export const metadata = {
  title: 'module.create.title',
  requireAuth: true,
  requireFeatures: ['module.create'],
  breadcrumb: [
    { labelKey: 'module.list.title', label: 'Items', href: '/backend/your-module' },
    { labelKey: 'module.create.title', label: 'Create' },
  ],
}
```

#### K.1.3 Detail Page Template

```tsx
// backend/<module>/[id]/page.tsx — detail page template
'use client'

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function DetailPage({ params }: { params: { id: string } }) {
  const t = useT()
  const router = useRouter()
  const { confirm } = useConfirmDialog()
  const [data, setData] = useState<YourEntity | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiCall(`/api/your-module/${params.id}`)
      .then((res) => {
        if (cancelled) return
        if (res.ok) setData(res.result)
        else setError(t('module.detail.notFound', 'Item not found'))
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [params.id])

  // REQUIRED: Use LoadingMessage instead of a raw Spinner
  if (isLoading) return <LoadingMessage />
  // REQUIRED: Use ErrorMessage instead of raw text
  if (error || !data) return <ErrorMessage message={error ?? t('module.detail.notFound', 'Not found')} />

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: t('module.delete.confirm.title', 'Delete item?'),
      description: t('module.delete.confirm.description', 'This action cannot be undone.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    const result = await deleteCrud(`/api/your-module/${params.id}`)
    if (result.ok) {
      flash(t('module.delete.success', 'Item deleted'), 'success')
      router.push('/backend/your-module')
    } else {
      flash(t('module.delete.error', 'Failed to delete'), 'error')
    }
  }

  return (
    <Page>
      <PageBody>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{data.name}</h2>
            <StatusBadge variant={mapStatusToVariant(data.status)}>
              {t(`module.status.${data.status}`, data.status)}
            </StatusBadge>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push(`edit`)}>
              {t('common.edit', 'Edit')}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t('common.delete', 'Delete')}
            </Button>
          </div>
        </div>
        {/* Detail sections — use tab layout if >3 sections */}
      </PageBody>
    </Page>
  )
}

export const metadata = {
  title: 'module.detail.title',
  requireAuth: true,
  requireFeatures: ['module.view'],
}
```

### K.2 Reference Module Documentation

The **customers** module (`packages/core/src/modules/customers/`) is the reference pattern with ~300 files. Below are the key files to study when creating a new module:

| Pattern | Reference file | What to study |
|---------|----------------|---------------|
| List with DataTable | `backend/customers/companies/page.tsx` | Columns, pagination, filters, RowActions, bulk actions |
| Create with CrudForm | `backend/customers/companies/create/page.tsx` | Form fields, validation, custom fields, flash |
| Detail with tabs | `backend/customers/companies/[id]/page.tsx` | Loading, tabs, sections, guarded mutations |
| CRUD API route | `api/companies/route.ts` | makeCrudRoute, openApi, query engine |
| Commands (Command pattern) | `commands/companies.ts` | create/update/delete with undo, before/after snapshots |
| Zod validators | `data/validators.ts` | Schema per entity, reusability |
| ORM entities | `data/entities.ts` | PK, FK, organization_id, timestamps |
| ACL features | `acl.ts` | `module.action` convention, granularity |
| Tenant setup | `setup.ts` | defaultRoleFeatures, seedDefaults |
| Events | `events.ts` | createModuleEvents, CRUD events |
| Search config | `search.ts` | Fulltext fields, facets, entity mapping |
| Custom entities | `ce.ts` | Field declarations per entity |
| Translations | `i18n/en.json` | Keys, structure, fallbacks |

**Rule**: before writing a new module, read the **entire** `packages/core/src/modules/customers/AGENTS.md`.

### K.3 Scaffold Script

Script that generates a new module skeleton with built-in page templates:

```bash
#!/usr/bin/env bash
# ds-scaffold-module.sh — scaffold a new module with DS-compliant templates
# Usage: ./ds-scaffold-module.sh <module_name> <entity_name>
# Example: ./ds-scaffold-module.sh invoices invoice

set -euo pipefail

MODULE="$1"
ENTITY="$2"

if [[ -z "$MODULE" || -z "$ENTITY" ]]; then
  echo "Usage: $0 <module_name> <entity_name>"
  echo "  module_name: plural, snake_case (e.g., invoices)"
  echo "  entity_name: singular, snake_case (e.g., invoice)"
  exit 1
fi

# Validate naming convention
if [[ "$MODULE" =~ [A-Z] ]]; then
  echo "ERROR: module_name must be snake_case (got: $MODULE)"
  exit 1
fi

MODULE_DIR="packages/core/src/modules/${MODULE}"

if [[ -d "$MODULE_DIR" ]]; then
  echo "ERROR: Module directory already exists: $MODULE_DIR"
  exit 1
fi

ENTITY_CAMEL=$(echo "$ENTITY" | perl -pe 's/_(\w)/uc($1)/ge')
ENTITY_PASCAL=$(echo "$ENTITY_CAMEL" | perl -pe 's/^(\w)/uc($1)/e')
MODULE_CAMEL=$(echo "$MODULE" | perl -pe 's/_(\w)/uc($1)/ge')

echo "Scaffolding module: $MODULE (entity: $ENTITY)"

# Create directory structure
mkdir -p "$MODULE_DIR"/{api/"$MODULE",backend/"$MODULE"/{create,"[id]"},commands,components,data,i18n,lib,widgets}

# index.ts
cat > "$MODULE_DIR/index.ts" << 'TMPL'
import type { ModuleMetadata } from '@open-mercato/shared/lib/module'

export const metadata: ModuleMetadata = {
  id: '__MODULE__',
  label: '__ENTITY_PASCAL__s',
}
TMPL
perl -i -pe "s/__MODULE__/$MODULE/g; s/__ENTITY_PASCAL__/$ENTITY_PASCAL/g" "$MODULE_DIR/index.ts"

# acl.ts
cat > "$MODULE_DIR/acl.ts" << 'TMPL'
import type { FeatureDefinition } from '@open-mercato/shared/lib/acl'

export const features: FeatureDefinition[] = [
  { id: '__MODULE__.view', label: 'View __MODULE__' },
  { id: '__MODULE__.create', label: 'Create __MODULE__' },
  { id: '__MODULE__.update', label: 'Update __MODULE__' },
  { id: '__MODULE__.delete', label: 'Delete __MODULE__' },
]
TMPL
perl -i -pe "s/__MODULE__/$MODULE/g" "$MODULE_DIR/acl.ts"

# data/validators.ts
cat > "$MODULE_DIR/data/validators.ts" << 'TMPL'
import { z } from 'zod'

export const __ENTITY_CAMEL__Schema = z.object({
  name: z.string().min(1),
})

export type __ENTITY_PASCAL__Input = z.infer<typeof __ENTITY_CAMEL__Schema>
TMPL
perl -i -pe "s/__ENTITY_CAMEL__/$ENTITY_CAMEL/g; s/__ENTITY_PASCAL__/$ENTITY_PASCAL/g" "$MODULE_DIR/data/validators.ts"

# i18n/en.json — translation keys
cat > "$MODULE_DIR/i18n/en.json" << TMPL
{
  "$MODULE": {
    "list": { "title": "${ENTITY_PASCAL}s" },
    "create": { "title": "Create $ENTITY_PASCAL", "success": "$ENTITY_PASCAL created", "error": "Failed to create" },
    "detail": { "title": "$ENTITY_PASCAL details", "notFound": "$ENTITY_PASCAL not found" },
    "delete": {
      "success": "$ENTITY_PASCAL deleted",
      "error": "Failed to delete",
      "confirm": { "title": "Delete $ENTITY_PASCAL?", "description": "This action cannot be undone." }
    },
    "empty": { "title": "No ${ENTITY_PASCAL}s yet", "description": "Create your first $ENTITY_PASCAL to get started." },
    "name": "Name",
    "status": "Status"
  }
}
TMPL

echo ""
echo "Module scaffolded at: $MODULE_DIR"
echo ""
echo "Next steps:"
echo "  1. Add entities in data/entities.ts (copy pattern from customers)"
echo "  2. Add backend pages (templates already follow DS guidelines)"
echo "  3. Add API routes in api/$MODULE/route.ts"
echo "  4. Register in apps/mercato/src/modules.ts"
echo "  5. Run: yarn generate && yarn db:generate"
echo "  6. Run: yarn lint && yarn build:packages"
echo ""
echo "Reference: packages/core/src/modules/customers/"
```

**Key scaffold features:**
- Enforces snake_case for module names
- Generates i18n keys from the start (no hardcoded strings)
- Creates a directory structure compliant with auto-discovery
- Does not generate pages — the contributor copies from K.1 templates and adapts

---

---

## See also

- [Lint Rules](./lint-rules.md) — automated rule enforcement in CI
- [Onboarding Guide](./onboarding-guide.md) — "Your First Module" guide
- [Components](./components.md) — components used in the templates
- [Principles](./principles.md) — design principles
