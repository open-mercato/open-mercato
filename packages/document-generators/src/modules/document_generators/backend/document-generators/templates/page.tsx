'use client'

import React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'

type Translator = (key: string, fallback: string) => string

function buildColumns(t: Translator): ColumnDef<TemplateMeta>[] {
  return [
    {
      accessorKey: 'id',
      header: t('document_generators.page.columns.id', 'ID'),
      meta: { maxWidth: 220, truncate: true },
    },
    {
      accessorKey: 'label',
      header: t('document_generators.page.columns.label', 'Label'),
    },
    {
      accessorKey: 'resourceKind',
      header: t('document_generators.page.columns.resource', 'Resource'),
      meta: { maxWidth: 160 },
    },
    {
      accessorKey: 'documentType',
      header: t('document_generators.page.columns.documentType', 'Document type'),
      meta: { maxWidth: 140 },
    },
    {
      accessorKey: 'format',
      header: t('document_generators.page.columns.format', 'Format'),
      meta: { maxWidth: 100 },
    },
    {
      accessorKey: 'description',
      header: t('document_generators.page.columns.description', 'Description'),
      meta: { truncate: true },
    },
    {
      accessorKey: 'note',
      header: t('document_generators.page.columns.note', 'Note'),
      meta: { truncate: true },
    },
  ]
}

function groupByModule(templates: TemplateMeta[]): Map<string, TemplateMeta[]> {
  const modules = new Map<string, TemplateMeta[]>()
  for (const template of templates) {
    const entries = modules.get(template.module) ?? []
    entries.push(template)
    modules.set(template.module, entries)
  }

  return modules
}

export default function DocumentGeneratorTemplatesPage() {
  const t = useT()
  const columns = React.useMemo(() => buildColumns(t), [t])
  const [templates, setTemplates] = React.useState<TemplateMeta[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false

    apiCall<TemplateMeta[]>('/api/document-generators/templates', { method: 'GET' })
      .then(({ ok, result }) => {
        if (!ok) throw new Error('[internal] Failed to load templates')
        if (cancelled) return
        setTemplates(Array.isArray(result) ? result : [])
      })
      .catch(() => {
        if (!cancelled) setError(t('document_generators.page.error', 'Failed to load templates.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [t])

  const grouped = groupByModule(templates)

  return (
    <Page data-testid="document-generators-templates-page">
      <PageHeader
        title={t('document_generators.page.title', 'Available templates')}
        description={t(
          'document_generators.page.description',
          'Registered document templates available in this application.',
        )}
      />
      <PageBody>
        {loading || error ? (
          <DataTable columns={columns} data={[]} isLoading={loading} error={error} disableRowClick />
        ) : (
          <div className="flex flex-col gap-10">
            {Array.from(grouped.entries()).map(([moduleId, moduleTemplates]) => (
              <section key={moduleId}>
                <h2 className="mb-4 text-base font-semibold capitalize">{moduleId}</h2>
                <div className="border-l pl-4">
                  <DataTable columns={columns} data={moduleTemplates} disableRowClick />
                </div>
              </section>
            ))}
          </div>
        )}
      </PageBody>
    </Page>
  )
}
