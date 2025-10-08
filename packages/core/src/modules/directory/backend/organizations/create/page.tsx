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

function flattenTree(nodes: TreeNode[], options: { excludeIds?: Set<string> } = {}): { value: string; label: string }[] {
  const result: { value: string; label: string }[] = []
  const exclude = options.excludeIds || new Set()
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
  { id: 'childIds', label: 'Children', type: 'select', multiple: true, options: [], placeholder: 'Select children to assign' },
  { id: 'isActive', label: 'Active', type: 'checkbox' },
]

const groups: CrudFormGroup[] = [
  { id: 'details', title: 'Details', column: 1, fields: ['name', 'parentId', 'childIds', 'isActive'] },
]

export default function CreateOrganizationPage() {
  const [fields, setFields] = React.useState(baseFields)

  React.useEffect(() => {
    let cancelled = false
    async function loadTree() {
      try {
        const res = await apiFetch('/api/directory/organizations?view=tree')
        if (!res.ok) return
        const data: TreeResponse = await res.json()
        if (cancelled) return
        const allOptions = flattenTree(data.items)
        setFields((prev) => prev.map((field) => {
          if (field.id === 'parentId') {
            return { ...field, options: [{ value: '', label: '— Root level —' }, ...allOptions] }
          }
          if (field.id === 'childIds') {
            return { ...field, options: allOptions }
          }
          return field
        }))
      } catch {}
    }
    loadTree()
    return () => { cancelled = true }
  }, [])

  return (
    <Page>
      <PageBody>
        <CrudForm
          title="Create Organization"
          backHref="/backend/directory/organizations"
          fields={fields}
          groups={groups}
          initialValues={{ name: '', parentId: '', childIds: [], isActive: true }}
          submitLabel="Create"
          cancelHref="/backend/directory/organizations"
          successRedirect="/backend/directory/organizations?flash=Organization%20created&type=success"
          onSubmit={async (values) => {
            const payload = {
              name: values.name,
              isActive: values.isActive !== false,
              parentId: values.parentId ? values.parentId : null,
              childIds: Array.isArray(values.childIds) ? values.childIds : [],
            }
            await apiFetch('/api/directory/organizations', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
          }}
        />
      </PageBody>
    </Page>
  )
}

