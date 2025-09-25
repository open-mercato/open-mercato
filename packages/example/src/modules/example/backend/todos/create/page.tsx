"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'

export default function CreateTodoPage() {
  const [fields, setFields] = React.useState<CrudField[]>([])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/custom_fields/definitions?entityId=example:todo`)
        const data = await res.json().catch(() => ({ items: [] }))
        const defs: Array<{ key: string; kind: string; label?: string; description?: string; options?: string[]; multi?: boolean; formEditable?: boolean }> = data?.items || []
        const out: CrudField[] = []
        // Base fields
        out.push({ id: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Write a clear title' })
        // Custom fields editable in forms
        for (const d of defs) {
          if (!d.formEditable) continue
          const id = `cf_${d.key}`
          const label = d.label || d.key
          if (d.kind === 'boolean') out.push({ id, label, type: 'checkbox', description: d.description })
          else if (d.kind === 'integer' || d.kind === 'float') out.push({ id, label, type: 'number', description: d.description })
          else if (d.kind === 'multiline') out.push({ id, label, type: 'textarea', description: d.description })
          else if (d.kind === 'select') {
            const options = (d.options || []).map((o) => ({ value: o, label: o[0]?.toUpperCase() + o.slice(1) }))
            out.push({ id, label, type: 'select', options, multiple: !!d.multi, description: d.description })
          } else out.push({ id, label, type: 'text', description: d.description })
        }
        out.push({ id: 'is_done', label: 'Done', type: 'checkbox' })
        if (!cancelled) setFields(out)
      } catch (_) {}
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <Page>
      <PageBody>
        <CrudForm
          title="Create Todo"
          backHref="/backend/todos"
          fields={fields}
          submitLabel="Create Todo"
          cancelHref="/backend/todos"
          successRedirect="/backend/todos"
          onSubmit={async (vals) => { await createCrud('example/todos', vals) }}
        />
      </PageBody>
    </Page>
  )
}
