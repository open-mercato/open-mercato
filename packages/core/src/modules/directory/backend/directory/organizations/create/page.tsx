"use client"
import * as React from 'react'
import { useT } from '@/lib/i18n/context'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { OrganizationSelect } from '@open-mercato/core/modules/directory/components/OrganizationSelect'
import { TenantSelect } from '@open-mercato/core/modules/directory/components/TenantSelect'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { type OrganizationTreeNode } from '@open-mercato/core/modules/directory/lib/tree'

type TreeResponse = {
  items: OrganizationTreeNode[]
}

type ChildTreeSelectProps = {
  nodes: OrganizationTreeNode[]
  value: string[]
  onChange: (vals: string[]) => void
}

function ChildTreeSelect({ nodes, value, onChange }: ChildTreeSelectProps) {
  const t = useT()
  const selected = React.useMemo(() => new Set(value), [value])
  const handleToggle = React.useCallback((id: string) => {
    const next = new Set(value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(Array.from(next))
  }, [value, onChange])

  if (!nodes.length) {
    return (
      <div className="text-sm text-muted-foreground">
        {t('directory.organizations.form.children.empty', 'No organizations available to assign.')}
      </div>
    )
  }

  return (
    <div className="rounded border px-3 py-2 max-h-64 overflow-auto space-y-2">
      <TreeCheckboxGroup nodes={nodes} selected={selected} onToggle={handleToggle} level={0} />
    </div>
  )
}

function TreeCheckboxGroup({ nodes, selected, onToggle, level }: { nodes: OrganizationTreeNode[]; selected: Set<string>; onToggle: (id: string) => void; level: number }) {
  return (
    <div className={level === 0 ? 'space-y-1' : 'space-y-1 pl-5'}>
      {nodes.map((node) => (
        <div key={node.id} className="space-y-1">
          <label className="inline-flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 mt-0.5"
              checked={selected.has(node.id)}
              onChange={() => onToggle(node.id)}
            />
            <span>{node.name}</span>
          </label>
          {node.children?.length ? (
            <TreeCheckboxGroup nodes={node.children} selected={selected} onToggle={onToggle} level={level + 1} />
          ) : null}
        </div>
      ))}
    </div>
  )
}

export default function CreateOrganizationPage() {
  const [tree, setTree] = React.useState<OrganizationTreeNode[]>([])
  const [actorIsSuperAdmin, setActorIsSuperAdmin] = React.useState(false)
  const [selectedTenantId, setSelectedTenantId] = React.useState<string | null>(null)
  const t = useT()

  const loadTree = React.useCallback(async (tenantId: string | null) => {
    const params = new URLSearchParams({ view: 'tree', includeInactive: 'true' })
    if (tenantId) params.set('tenantId', tenantId)
    try {
      const call = await apiCall<TreeResponse>(`/api/directory/organizations?${params.toString()}`)
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setTree(items)
    } catch {
      setTree([])
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      try {
        const call = await apiCall<{ isSuperAdmin?: boolean }>('/api/auth/roles?page=1&pageSize=1')
        if (!cancelled) setActorIsSuperAdmin(Boolean(call.result?.isSuperAdmin))
      } catch {
        if (!cancelled) setActorIsSuperAdmin(false)
      }
      if (!cancelled) await loadTree(null)
    }
    bootstrap()
    return () => { cancelled = true }
  }, [loadTree])

  React.useEffect(() => {
    if (!actorIsSuperAdmin) return
    void loadTree(selectedTenantId)
  }, [actorIsSuperAdmin, loadTree, selectedTenantId])

  const fields = React.useMemo<CrudField[]>(() => [
    ...(actorIsSuperAdmin ? [
      {
        id: 'tenantId',
        label: t('directory.organizations.form.field.tenant', 'Tenant'),
        type: 'custom',
        required: true,
        component: ({ value, setValue }) => (
          <TenantSelect
            id="tenantId"
            value={typeof value === 'string' ? value : selectedTenantId}
            onChange={(next) => {
              const normalized = next ?? null
              setSelectedTenantId(normalized)
              setValue(normalized)
            }}
            includeEmptyOption={false}
            className="w-full h-9 rounded border px-2 text-sm"
          />
        ),
      } as CrudField,
    ] : []),
    { id: 'name', label: t('directory.organizations.form.field.name', 'Name'), type: 'text', required: true },
    {
      id: 'parentId',
      label: t('directory.organizations.form.field.parent', 'Parent'),
      type: 'custom',
      component: ({ id, value, setValue }) => (
        <OrganizationSelect
          id={id}
          value={value ? String(value) : null}
          onChange={(next) => setValue(next ?? '')}
          tenantId={selectedTenantId}
          fetchOnMount={true}
          includeEmptyOption
          emptyOptionLabel={t('directory.organizations.form.rootOption', '— Root level —')}
          className="w-full h-9 rounded border px-2 text-sm"
        />
      ),
    },
    {
      id: 'childIds',
      label: t('directory.organizations.form.field.children', 'Children'),
      type: 'custom',
      component: ({ value, setValue }) => (
        <ChildTreeSelect
          nodes={tree}
          value={Array.isArray(value) ? value : []}
          onChange={(vals) => setValue(vals)}
        />
      ),
    },
    { id: 'isActive', label: t('directory.organizations.form.field.isActive', 'Active'), type: 'checkbox' },
  ], [actorIsSuperAdmin, selectedTenantId, t, tree])

  const detailFields = React.useMemo(() => (
    actorIsSuperAdmin
      ? ['tenantId', 'name', 'parentId', 'childIds', 'isActive']
      : ['name', 'parentId', 'childIds', 'isActive']
  ), [actorIsSuperAdmin])

  const groups: CrudFormGroup[] = React.useMemo(() => ([
    { id: 'details', title: t('directory.organizations.form.group.details', 'Details'), column: 1, fields: detailFields },
    { id: 'custom', title: t('directory.organizations.form.group.customFields', 'Custom Data'), column: 2, kind: 'customFields' },
  ]), [detailFields, t])
  const formTitle = t('directory.nav.organizations.create', 'Create Organization')
  const successMessage = encodeURIComponent(t('directory.organizations.flash.created', 'Organization created'))

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={formTitle}
          backHref="/backend/directory/organizations"
          fields={fields}
          groups={groups}
          entityId={E.directory.organization}
          initialValues={{ tenantId: selectedTenantId ?? null, name: '', parentId: '', childIds: [], isActive: true }}
          submitLabel={t('directory.organizations.form.action.create', 'Create')}
          cancelHref="/backend/directory/organizations"
          successRedirect={`/backend/directory/organizations?flash=${successMessage}&type=success`}
          onSubmit={async (values) => {
            await submitCreateOrganization({
              values: values as Record<string, unknown>,
              actorIsSuperAdmin,
              selectedTenantId,
              messages: {
                tenantRequired: t('directory.organizations.errors.tenantRequired', 'Tenant selection is required for super administrators'),
              },
            })
          }}
        />
      </PageBody>
    </Page>
  )
}

type CreateOrganizationPayload = {
  name: string
  isActive: boolean
  parentId: string | null
  childIds: string[]
  tenantId?: string
  customFields?: Record<string, unknown>
}

type CreateOrganizationRequest = (payload: CreateOrganizationPayload) => Promise<void>

async function defaultCreateOrganizationRequest(payload: CreateOrganizationPayload) {
  await createCrud('directory/organizations', payload)
}

export async function submitCreateOrganization(options: {
  values: Record<string, unknown>
  actorIsSuperAdmin: boolean
  selectedTenantId: string | null
  createOrganization?: CreateOrganizationRequest
  messages?: {
    tenantRequired?: string
  }
}): Promise<void> {
  const {
    values,
    actorIsSuperAdmin,
    selectedTenantId,
    createOrganization = defaultCreateOrganizationRequest,
    messages,
  } = options

  const customFields = collectCustomFieldValues(values)

  const tenantValue =
    typeof values.tenantId === 'string' && values.tenantId.trim().length
      ? values.tenantId.trim()
      : selectedTenantId

  if (actorIsSuperAdmin && !tenantValue) {
    const message = messages?.tenantRequired ?? 'Tenant selection is required for super administrators'
    throw createCrudFormError(message, {
      tenantId: message,
    })
  }

  const payload: CreateOrganizationPayload = {
    name: typeof values.name === 'string' ? values.name : '',
    isActive: values.isActive !== false,
    parentId: typeof values.parentId === 'string' && values.parentId.length
      ? values.parentId
      : null,
    childIds: Array.isArray(values.childIds) ? values.childIds.filter((id): id is string => typeof id === 'string') : [],
  }

  if (tenantValue) payload.tenantId = tenantValue
  if (Object.keys(customFields).length > 0) payload.customFields = customFields

  await createOrganization(payload)
}
