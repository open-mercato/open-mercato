"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import {
  buildOrganizationTreeOptions,
  formatOrganizationTreeLabel,
  type OrganizationTreeNode,
} from '@open-mercato/core/modules/directory/lib/tree'

type TreeResponse = {
  items: OrganizationTreeNode[]
}

type ChildTreeSelectProps = {
  nodes: OrganizationTreeNode[]
  value: string[]
  onChange: (vals: string[]) => void
}

function flattenTree(nodes: OrganizationTreeNode[]): { value: string; label: string }[] {
  const options = buildOrganizationTreeOptions(nodes)
  return options.map((opt) => ({
    value: opt.value,
    label: formatOrganizationTreeLabel(opt.name, opt.depth),
  }))
}

function ChildTreeSelect({ nodes, value, onChange }: ChildTreeSelectProps) {
  const selected = React.useMemo(() => new Set(value), [value])
  const handleToggle = React.useCallback((id: string) => {
    const next = new Set(value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(Array.from(next))
  }, [value, onChange])

  if (!nodes.length) {
    return (
      <div className="text-sm text-muted-foreground">No organizations available to assign.</div>
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

const groups: CrudFormGroup[] = [
  { id: 'details', title: 'Details', column: 1, fields: ['name', 'parentId', 'childIds', 'isActive'] },
]

export default function CreateOrganizationPage() {
  const [parentOptions, setParentOptions] = React.useState<{ value: string; label: string }[]>([])
  const [tree, setTree] = React.useState<OrganizationTreeNode[]>([])

  React.useEffect(() => {
    let cancelled = false
    async function loadTree() {
      try {
        const res = await apiFetch('/api/directory/organizations?view=tree')
        if (!res.ok) return
        const data: TreeResponse = await res.json()
        if (cancelled) return
        const items = Array.isArray(data.items) ? data.items : []
        setTree(items)
        setParentOptions(flattenTree(items))
      } catch {}
    }
    loadTree()
    return () => { cancelled = true }
  }, [])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'parentId', label: 'Parent', type: 'select', options: [{ value: '', label: '— Root level —' }, ...parentOptions], placeholder: 'No parent (root)' },
    {
      id: 'childIds',
      label: 'Children',
      type: 'custom',
      component: ({ value, setValue }) => (
        <ChildTreeSelect
          nodes={tree}
          value={Array.isArray(value) ? value : []}
          onChange={(vals) => setValue(vals)}
        />
      ),
    },
    { id: 'isActive', label: 'Active', type: 'checkbox' },
  ], [parentOptions, tree])

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
