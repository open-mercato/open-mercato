"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup, type CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'

type TreeNode = {
  id: string
  name: string
  depth: number
  children?: TreeNode[]
}

type TreeResponse = {
  items: TreeNode[]
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
  }>
}

type TreeOption = { value: string; name: string; depth: number }
type EntityRecordResponse = { items?: Record<string, any>[] }

const TREE_STEP = 16
const TREE_PADDING = 12

function formatTreeOptionLabel(name: string, depth: number): string {
  if (depth <= 0) return name
  return `${'\u00A0'.repeat(Math.max(0, (depth - 1) * 2))}↳ ${name}`
}

function buildTreeOptions(nodes: TreeNode[], exclude: Set<string> = new Set()): TreeOption[] {
  const result: TreeOption[] = []
  function walk(list: TreeNode[]) {
    for (const node of list) {
      if (!exclude.has(node.id)) {
        result.push({ value: node.id, name: node.name, depth: node.depth })
      }
      if (node.children?.length) walk(node.children)
    }
  }
  walk(nodes)
  return result
}

const groups: CrudFormGroup[] = [
  { id: 'details', title: 'Details', column: 1, fields: ['name', 'parentId', 'childrenInfo', 'isActive'] },
  { id: 'custom', title: 'Custom Fields', column: 1, kind: 'customFields' },
]

export default function EditOrganizationPage({ params }: { params?: { id?: string } }) {
  const orgId = params?.id
  const [initialValues, setInitialValues] = React.useState<any | null>(null)
  const [pathLabel, setPathLabel] = React.useState<string>('')
  const [tenantId, setTenantId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [parentOptions, setParentOptions] = React.useState<CrudFieldOption[]>([{ value: '', label: '— Root level —' }])
  const [childSummary, setChildSummary] = React.useState<TreeOption[]>([])
  const [childIds, setChildIds] = React.useState<string[]>([])

  React.useEffect(() => {
    if (!orgId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const orgRes = await apiFetch(`/api/directory/organizations?view=manage&ids=${orgId}&status=all&includeInactive=true&page=1&pageSize=1`)
        if (!orgRes.ok) throw new Error('Failed to load organization')
        const orgData: OrganizationResponse = await orgRes.json()
        const record = orgData.items?.[0]
        if (!record) throw new Error('Organization not found')
        setTenantId(record.tenantId || null)
        const treeParams = new URLSearchParams({ view: 'tree', includeInactive: 'true' })
        if (record.tenantId) treeParams.set('tenantId', record.tenantId)
        treeParams.set('ids', orgId)
        const treeRes = await apiFetch(`/api/directory/organizations?${treeParams.toString()}`)
        if (!treeRes.ok) throw new Error('Failed to load hierarchy')
        const tree: TreeResponse = await treeRes.json()
        if (cancelled) return
        const excludedForParent = new Set<string>([orgId, ...record.descendantIds])
        const excludedForChildren = new Set<string>([orgId, ...record.ancestorIds])
        const fullTree = buildTreeOptions(tree.items)
        const parentTree = buildTreeOptions(tree.items, excludedForParent)
        setParentOptions([{ value: '', label: '— Root level —' }, ...parentTree.map((opt) => ({ value: opt.value, label: formatTreeOptionLabel(opt.name, opt.depth) }))])
        const nodeMap = new Map(fullTree.map((opt) => [opt.value, opt]))
        const childrenDetails = record.childIds
          .map((id) => nodeMap.get(id))
          .filter((node): node is TreeOption => !!node)
        setChildSummary(childrenDetails)
        setChildIds(Array.isArray(record.childIds) ? record.childIds : [])

        let customValues: Record<string, any> = {}
        try {
          const qs = new URLSearchParams({
            entityId: E.directory.organization,
            page: '1',
            pageSize: '1',
            sortField: 'id',
            sortDir: 'asc',
            id: orgId,
          })
          const cfRes = await apiFetch(`/api/entities/records?${qs.toString()}`)
          if (cfRes.ok) {
            const cfJson: EntityRecordResponse = await cfRes.json().catch(() => ({}))
            const cfItem = (cfJson.items || []).find((it) => it && String((it as any).id) === String(record.id)) || null
            if (cfItem && typeof cfItem === 'object') {
              const collected: Record<string, any> = {}
              for (const [key, value] of Object.entries(cfItem)) {
                if (key.startsWith('cf_')) collected[key] = value
                else if (key.startsWith('cf:')) collected[`cf_${key.slice(3)}`] = value
              }
              customValues = collected
            }
          }
        } catch {
          customValues = {}
        }
        setInitialValues({
          id: record.id,
          name: record.name,
          parentId: record.parentId || '',
          isActive: record.isActive,
          childIds: Array.isArray(record.childIds) ? record.childIds : [],
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
    { id: 'parentId', label: 'Parent', type: 'select', options: parentOptions, placeholder: 'No parent (root)' },
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
  ], [parentOptions, childSummary])

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
            const payload: {
              id: string
              name: string
              isActive: boolean
              parentId: string | null
              childIds: string[]
              tenantId?: string
              customFields?: Record<string, any>
            } = {
              id: values.id || orgId,
              name: values.name,
              isActive: values.isActive !== false,
              parentId: values.parentId ? values.parentId : null,
              childIds: Array.isArray(values.childIds) ? values.childIds : childIds,
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
