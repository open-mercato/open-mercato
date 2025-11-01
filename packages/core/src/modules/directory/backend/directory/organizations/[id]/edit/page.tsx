"use client"
import * as React from 'react'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { OrganizationSelect } from '@open-mercato/core/modules/directory/components/OrganizationSelect'
import {
  buildOrganizationTreeOptions,
  type OrganizationTreeNode,
  type OrganizationTreeOption,
} from '@open-mercato/core/modules/directory/lib/tree'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'

type TreeResponse = {
  items: OrganizationTreeNode[]
}

type OrganizationResponse = {
  items: Array<{
    id: string
    name: string
    tenantId: string
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

const groups: CrudFormGroup[] = [
  { id: 'details', title: 'Details', column: 1, fields: ['name', 'parentId', 'childrenInfo', 'isActive'] },
  { id: 'custom', title: 'Custom Data', column: 2, kind: 'customFields' },
]

export default function EditOrganizationPage({ params }: { params?: { id?: string } }) {
  const orgId = params?.id
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
  const [initialValues, setInitialValues] = React.useState<Record<string, unknown> | null>(null)
  const [pathLabel, setPathLabel] = React.useState<string>('')
  const [tenantId, setTenantId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [parentTree, setParentTree] = React.useState<OrganizationTreeNode[]>([])
  const [childSummary, setChildSummary] = React.useState<OrganizationTreeOption[]>([])
  const [originalChildIds, setOriginalChildIds] = React.useState<string[]>([])

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
        setTenantId(record.tenantId || null)
        const treeParams = new URLSearchParams({ view: 'tree', includeInactive: 'true' })
        if (record.tenantId) treeParams.set('tenantId', record.tenantId)
        treeParams.set('ids', currentOrgId)
        const treeRes = await apiFetch(`/api/directory/organizations?${treeParams.toString()}`)
        if (!treeRes.ok) throw new Error('Failed to load hierarchy')
        const tree: TreeResponse = await treeRes.json()
        if (cancelled) return
        const excludedForParent = new Set<string>([currentOrgId, ...record.descendantIds])
        const markSelectable = (nodes: OrganizationTreeNode[]): OrganizationTreeNode[] => nodes.map((node) => ({
          ...node,
          selectable: !excludedForParent.has(node.id),
          children: Array.isArray(node.children) ? markSelectable(node.children) : [],
        }))
        const baseTree = Array.isArray(tree.items) ? tree.items : []
        const treeWithSelectable = markSelectable(baseTree)
        setParentTree(treeWithSelectable)
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
          ...customValues,
        })
        setPathLabel(record.pathLabel)
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load organization')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [orgId])

  const fields = React.useMemo<CrudField[]>(() => [
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
  ], [parentTree, childSummary])

  if (!orgId) return null

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
          initialValues={initialValues ?? { id: orgId, name: '', parentId: '', isActive: true, childIds: [] }}
          isLoading={loading}
          loadingMessage="Loading organization..."
          submitLabel="Save"
          cancelHref="/backend/directory/organizations"
          successRedirect="/backend/directory/organizations?flash=Organization%20updated&type=success"
          extraActions={pathLabel ? <span className="text-xs text-muted-foreground">Path: {pathLabel}</span> : null}
          onSubmit={async (values) => {
            const payloadId = typeof values.id === 'string' && values.id.length ? values.id : orgId
            const payloadName = typeof values.name === 'string' ? values.name : ''
            const payloadParentId = typeof values.parentId === 'string' && values.parentId.length ? values.parentId : null
            const payload: {
              id: string
              name: string
              isActive: boolean
              parentId: string | null
              childIds: string[]
              tenantId?: string
              customFields?: Record<string, any>
            } = {
              id: payloadId,
              name: payloadName,
              isActive: values.isActive !== false,
              parentId: payloadParentId,
              childIds: originalChildIds,
            }
            const customFields: Record<string, any> = {}
            for (const [key, value] of Object.entries(values)) {
              if (key.startsWith('cf_')) customFields[key.slice(3)] = value
              else if (key.startsWith('cf:')) customFields[key.slice(3)] = value
            }
            if (Object.keys(customFields).length > 0) {
              payload.customFields = customFields
            }
            if (tenantId) payload.tenantId = tenantId
            await apiFetch('/api/directory/organizations', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
          }}
          onDelete={async () => {
            await apiFetch(`/api/directory/organizations?id=${encodeURIComponent(orgId)}`, { method: 'DELETE' })
          }}
          deleteRedirect="/backend/directory/organizations?flash=Organization%20deleted&type=success"
        />
      </PageBody>
    </Page>
  )
}
