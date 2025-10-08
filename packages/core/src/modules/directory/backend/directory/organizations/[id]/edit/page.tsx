"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
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
    parentId: string | null
    childIds: string[]
    ancestorIds: string[]
    descendantIds: string[]
    isActive: boolean
    pathLabel: string
  }>
}

function flattenTree(nodes: TreeNode[], exclude: Set<string> = new Set()): { value: string; label: string }[] {
  const result: { value: string; label: string }[] = []
  function walk(list: TreeNode[]) {
    for (const node of list) {
      if (!exclude.has(node.id)) {
        const indent = node.depth > 0 ? `${'\u00A0\u00A0'.repeat(node.depth)}• ` : ''
        result.push({ value: node.id, label: `${indent}${node.name}` })
      }
      if (node.children?.length) walk(node.children)
    }
  }
  walk(nodes)
  return result
}

const baseFields: CrudField[] = [
  { id: 'name', label: 'Name', type: 'text', required: true },
  { id: 'parentId', label: 'Parent', type: 'select', options: [], placeholder: 'No parent (root)' },
  { id: 'childIds', label: 'Children', type: 'select', multiple: true, options: [], placeholder: 'Select children' },
  { id: 'isActive', label: 'Active', type: 'checkbox' },
]

const groups: CrudFormGroup[] = [
  { id: 'details', title: 'Details', column: 1, fields: ['name', 'parentId', 'childIds', 'isActive'] },
]

export default function EditOrganizationPage({ params }: { params?: { id?: string } }) {
  const orgId = params?.id
  const [fields, setFields] = React.useState(baseFields)
  const [initialValues, setInitialValues] = React.useState<any | null>(null)
  const [pathLabel, setPathLabel] = React.useState<string>('')
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!orgId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [treeRes, orgRes] = await Promise.all([
          apiFetch('/api/directory/organizations?view=tree&includeInactive=true'),
          apiFetch(`/api/directory/organizations?view=manage&ids=${orgId}&status=all&includeInactive=true&page=1&pageSize=1`),
        ])
        if (!treeRes.ok) throw new Error('Failed to load hierarchy')
        if (!orgRes.ok) throw new Error('Failed to load organization')
        const tree: TreeResponse = await treeRes.json()
        const orgData: OrganizationResponse = await orgRes.json()
        const record = orgData.items?.[0]
        if (!record) throw new Error('Organization not found')
        if (cancelled) return
        const excludedForParent = new Set<string>([orgId, ...record.descendantIds])
        const excludedForChildren = new Set<string>([orgId, ...record.ancestorIds])
        const parentOptions = [{ value: '', label: '— Root level —' }, ...flattenTree(tree.items, excludedForParent)]
        const childOptions = flattenTree(tree.items, excludedForChildren)
        setFields(baseFields.map((field) => {
          if (field.id === 'parentId') return { ...field, options: parentOptions }
          if (field.id === 'childIds') return { ...field, options: childOptions }
          return field
        }))
        setInitialValues({
          id: record.id,
          name: record.name,
          parentId: record.parentId || '',
          childIds: Array.isArray(record.childIds) ? record.childIds : [],
          isActive: record.isActive,
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
          initialValues={initialValues ?? { id: orgId, name: '', parentId: '', childIds: [], isActive: true }}
          isLoading={loading}
          loadingMessage="Loading organization..."
          submitLabel="Save"
          cancelHref="/backend/directory/organizations"
          successRedirect="/backend/directory/organizations?flash=Organization%20updated&type=success"
          extraActions={pathLabel ? <span className="text-xs text-muted-foreground">Path: {pathLabel}</span> : null}
          onSubmit={async (values) => {
            const payload = {
              id: values.id || orgId,
              name: values.name,
              isActive: values.isActive !== false,
              parentId: values.parentId ? values.parentId : null,
              childIds: Array.isArray(values.childIds) ? values.childIds : [],
            }
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

