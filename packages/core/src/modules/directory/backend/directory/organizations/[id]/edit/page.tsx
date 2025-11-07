"use client"
import * as React from 'react'
import { useT } from '@/lib/i18n/context'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { OrganizationSelect } from '@open-mercato/core/modules/directory/components/OrganizationSelect'
import { TenantSelect } from '@open-mercato/core/modules/directory/components/TenantSelect'
import {
  buildOrganizationTreeOptions,
  type OrganizationTreeNode,
  type OrganizationTreeOption,
} from '@open-mercato/core/modules/directory/lib/tree'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError, raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'

type TreeResponse = {
  items: OrganizationTreeNode[]
}

type OrganizationResponse = {
  items: Array<{
    id: string
    name: string
    tenantId: string
    tenantName?: string | null
    parentId: string | null
    childIds: string[]
    ancestorIds: string[]
    descendantIds: string[]
    isActive: boolean
    pathLabel: string
  } & Record<string, unknown>>
}

const TREE_STEP = 16
const TREE_PADDING = 12

export default function EditOrganizationPage({ params }: { params?: { id?: string } }) {
  const orgId = params?.id
  const t = useT()
  const [initialValues, setInitialValues] = React.useState<Record<string, unknown> | null>(null)
  const [pathLabel, setPathLabel] = React.useState<string>('')
  const [tenantId, setTenantId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [parentTree, setParentTree] = React.useState<OrganizationTreeNode[]>([])
  const [childSummary, setChildSummary] = React.useState<OrganizationTreeOption[]>([])
  const [originalChildIds, setOriginalChildIds] = React.useState<string[]>([])
  const [actorIsSuperAdmin, setActorIsSuperAdmin] = React.useState(false)
  const skipTenantEffectRef = React.useRef(true)

  React.useEffect(() => {
    let cancelled = false
    async function loadActor() {
      try {
        const res = await apiFetch('/api/auth/roles?page=1&pageSize=1')
        if (!res.ok) return
        const payload = await res.json().catch(() => ({}))
        if (!cancelled) setActorIsSuperAdmin(Boolean(payload?.isSuperAdmin))
      } catch {
        if (!cancelled) setActorIsSuperAdmin(false)
      }
    }
    loadActor()
    return () => { cancelled = true }
  }, [])

  const markSelectable = React.useCallback((nodes: OrganizationTreeNode[], excluded: Set<string>): OrganizationTreeNode[] => (
    nodes.map((node) => ({
      ...node,
      selectable: !excluded.has(node.id),
      children: Array.isArray(node.children) ? markSelectable(node.children, excluded) : [],
    }))
  ), [])

  const loadParentTree = React.useCallback(async (
    targetTenantId: string | null,
    excludedIds: Iterable<string>,
  ): Promise<OrganizationTreeNode[]> => {
    const treeParams = new URLSearchParams({ view: 'tree', includeInactive: 'true' })
    if (targetTenantId) treeParams.set('tenantId', targetTenantId)
    if (orgId) treeParams.set('ids', orgId)
    try {
      const res = await apiFetch(`/api/directory/organizations?${treeParams.toString()}`)
      if (!res.ok) {
        setParentTree([])
        return []
      }
      const tree: TreeResponse = await res.json()
      const baseTree = Array.isArray(tree.items) ? tree.items : []
      const excludedSet = new Set<string>(excludedIds)
      if (orgId) excludedSet.add(orgId)
      setParentTree(markSelectable(baseTree, excludedSet))
      return baseTree
    } catch {
      setParentTree([])
      return []
    }
  }, [markSelectable, orgId])

  React.useEffect(() => {
    if (!orgId) return
    const currentOrgId = orgId
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const orgRes = await apiFetch(`/api/directory/organizations?view=manage&ids=${currentOrgId}&status=all&includeInactive=true&page=1&pageSize=1`)
        if (!orgRes.ok) throw new Error('Failed to load organization')
        const orgData: OrganizationResponse = await orgRes.json()
        const record = orgData.items?.[0]
        if (!record) throw new Error('Organization not found')
        const resolvedTenantId = record.tenantId || null
        setTenantId(resolvedTenantId)
        const baseTree = await loadParentTree(resolvedTenantId, record.descendantIds ?? [])
        const fullTree = buildOrganizationTreeOptions(baseTree)
        const nodeMap = new Map(fullTree.map((opt) => [opt.value, opt]))
        const childrenDetails = record.childIds
          .map((id) => nodeMap.get(id))
          .filter((node): node is OrganizationTreeOption => !!node)
        setChildSummary(childrenDetails)
        setOriginalChildIds(Array.isArray(record.childIds) ? record.childIds : [])

        const customValues: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
          if (key.startsWith('cf_')) customValues[key] = value
          else if (key.startsWith('cf:')) customValues[`cf_${key.slice(3)}`] = value
        }
        setInitialValues({
          id: record.id,
          name: record.name,
          parentId: record.parentId || '',
          isActive: record.isActive,
          tenantId: resolvedTenantId,
          ...customValues,
        })
        setPathLabel(record.pathLabel)
      } catch (err: unknown) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load organization'
          setError(message)
        }
      } finally {
        if (!cancelled) {
          skipTenantEffectRef.current = false
          setLoading(false)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [loadParentTree, orgId])

  React.useEffect(() => {
    if (!actorIsSuperAdmin) return
    if (skipTenantEffectRef.current) {
      skipTenantEffectRef.current = false
      return
    }
    if (!orgId) return
    if (!tenantId) {
      setParentTree([])
      setChildSummary([])
      setOriginalChildIds([])
      return
    }
    void loadParentTree(tenantId, [])
    setChildSummary([])
    setOriginalChildIds([])
  }, [actorIsSuperAdmin, loadParentTree, orgId, tenantId])

  const fields = React.useMemo<CrudField[]>(() => [
    ...(actorIsSuperAdmin ? [
      {
        id: 'tenantId',
        label: 'Tenant',
        type: 'custom',
        component: ({ value, setValue }) => (
          <TenantSelect
            id="tenantId"
            value={typeof value === 'string' ? value : tenantId}
            onChange={(next) => {
              const normalized = next ?? null
              setTenantId(normalized)
              setValue(normalized)
            }}
            includeEmptyOption={false}
            className="w-full h-9 rounded border px-2 text-sm"
          />
        ),
      } as CrudField,
    ] : []),
    { id: 'name', label: 'Name', type: 'text', required: true },
    {
      id: 'parentId',
      label: 'Parent',
      type: 'custom',
      component: ({ id, value, setValue }) => (
        <OrganizationSelect
          id={id}
          value={value ? String(value) : null}
          onChange={(next) => setValue(next ?? '')}
          nodes={parentTree}
          includeEmptyOption
          emptyOptionLabel="— Root level —"
          className="w-full h-9 rounded border px-2 text-sm"
        />
      ),
    },
    {
      id: 'childrenInfo',
      label: 'Children',
      type: 'custom',
      component: () => {
        if (!childSummary.length) {
          return <p className="text-xs text-muted-foreground">No direct children assigned.</p>
        }
        return (
          <ul className="space-y-1 text-sm">
            {childSummary.map((child) => (
              <li key={child.value} className="leading-none">
                <span style={{ paddingLeft: child.depth > 0 ? TREE_PADDING + (child.depth - 1) * TREE_STEP : 0 }}>
                  {child.depth > 0 ? <span className="text-muted-foreground">↳ </span> : null}
                  {child.name}
                </span>
              </li>
            ))}
          </ul>
        )
      },
    },
    { id: 'isActive', label: 'Active', type: 'checkbox' },
  ], [actorIsSuperAdmin, parentTree, childSummary, tenantId])

  const detailFields = React.useMemo(() => (
    actorIsSuperAdmin
      ? ['tenantId', 'name', 'parentId', 'childrenInfo', 'isActive']
      : ['name', 'parentId', 'childrenInfo', 'isActive']
  ), [actorIsSuperAdmin])

  const groups: CrudFormGroup[] = React.useMemo(() => ([
    { id: 'details', title: 'Details', column: 1, fields: detailFields },
    { id: 'custom', title: 'Custom Data', column: 2, kind: 'customFields' },
  ]), [detailFields])

  if (!orgId) {
    return (
      <Page>
        <PageBody>
          <div className="rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Organization identifier is missing.
          </div>
        </PageBody>
      </Page>
    )
  }

  if (error && !loading && !initialValues) {
    return (
      <Page>
        <PageBody>
          <div className="rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm
          title="Edit Organization"
          backHref="/backend/directory/organizations"
          fields={fields}
          groups={groups}
          entityId={E.directory.organization}
          initialValues={initialValues ?? { id: orgId, tenantId: tenantId ?? null, name: '', parentId: '', isActive: true, childIds: [] }}
          isLoading={loading}
          loadingMessage="Loading organization..."
          submitLabel="Save"
          cancelHref="/backend/directory/organizations"
          successRedirect="/backend/directory/organizations?flash=Organization%20updated&type=success"
          extraActions={pathLabel ? <span className="text-xs text-muted-foreground">Path: {pathLabel}</span> : null}
          onSubmit={async (values) => {
            await submitUpdateOrganization({
              values: values as Record<string, unknown>,
              orgId: orgId ?? '',
              tenantId,
              originalChildIds,
              messages: {
                orgIdRequired: t('directory.organizations.errors.orgIdRequired', 'Organization identifier is required'),
              },
            })
          }}
          onDelete={async () => {
            const res = await apiFetch(`/api/directory/organizations?id=${encodeURIComponent(orgId ?? '')}`, { method: 'DELETE' })
            if (!res.ok) {
              await raiseCrudError(res, t('directory.organizations.errors.deleteFailed', 'Failed to delete organization'))
            }
          }}
          deleteRedirect="/backend/directory/organizations?flash=Organization%20deleted&type=success"
        />
      </PageBody>
    </Page>
  )
}

type UpdateOrganizationPayload = {
  id: string
  name: string
  isActive: boolean
  parentId: string | null
  childIds: string[]
  tenantId?: string | null
  customFields?: Record<string, unknown>
}

type UpdateOrganizationRequest = (payload: UpdateOrganizationPayload) => Promise<void>

async function defaultUpdateOrganizationRequest(payload: UpdateOrganizationPayload) {
  await updateCrud('directory/organizations', payload)
}

export async function submitUpdateOrganization(options: {
  values: Record<string, unknown>
  orgId: string
  tenantId: string | null
  originalChildIds: string[]
  updateOrganization?: UpdateOrganizationRequest
  messages?: {
    orgIdRequired?: string
  }
}): Promise<void> {
  const {
    values,
    orgId,
    tenantId,
    originalChildIds,
    updateOrganization = defaultUpdateOrganizationRequest,
    messages,
  } = options

  const payloadId = typeof values.id === 'string' && values.id.length ? values.id : orgId
  if (!payloadId) {
    const message = messages?.orgIdRequired ?? 'Organization identifier is required'
    throw createCrudFormError(message, { id: message })
  }

  const customFields = collectCustomFieldValues(values)

  const submittedTenantId =
    typeof values.tenantId === 'string' && values.tenantId.trim().length
      ? values.tenantId.trim()
      : tenantId

  const payload: UpdateOrganizationPayload = {
    id: payloadId,
    name: typeof values.name === 'string' ? values.name : '',
    isActive: values.isActive !== false,
    parentId:
      typeof values.parentId === 'string' && values.parentId.length
        ? values.parentId
        : null,
    childIds: originalChildIds,
  }

  if (submittedTenantId !== undefined && submittedTenantId !== null) {
    payload.tenantId = submittedTenantId
  }
  if (Object.keys(customFields).length > 0) {
    payload.customFields = customFields
  }

  await updateOrganization(payload)
}
