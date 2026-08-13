'use client'

import React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'

type TemplatesResponse = { internal: TemplateMeta[]; external: TemplateMeta[] }

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

function groupByModule(
  internal: TemplateMeta[],
  external: TemplateMeta[],
): Map<string, { internal: TemplateMeta[]; external: TemplateMeta[] }> {
  const modules = new Map<string, { internal: TemplateMeta[]; external: TemplateMeta[] }>()

  const ensure = (moduleId: string) => {
    if (!modules.has(moduleId)) modules.set(moduleId, { internal: [], external: [] })
    return modules.get(moduleId)!
  }

  for (const template of internal) ensure(template.module).internal.push(template)
  for (const template of external) ensure(template.module).external.push(template)

  return modules
}

export default function DocumentGeneratorTemplatesPage() {
  const t = useT()
  const columns = React.useMemo(() => buildColumns(t), [t])
  const [internal, setInternal] = React.useState<TemplateMeta[]>([])
  const [external, setExternal] = React.useState<TemplateMeta[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false

    apiCall<TemplatesResponse>('/api/document-generators/templates', { method: 'GET' })
      .then(({ ok, result }) => {
        if (!ok) throw new Error('[internal] Failed to load templates')
        if (cancelled) return
        setInternal(result?.internal ?? [])
        setExternal(result?.external ?? [])
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

  const grouped = groupByModule(internal, external)

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
            {Array.from(grouped.entries()).map(([moduleId, { internal: moduleInternal, external: moduleExternal }]) => (
              <section key={moduleId}>
                <h2 className="mb-4 text-base font-semibold capitalize">{moduleId}</h2>
                <div className="flex flex-col gap-6 border-l pl-4">
                  {moduleInternal.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t('document_generators.page.internal', 'Internal')}
                      </h3>
                      <DataTable columns={columns} data={moduleInternal} disableRowClick />
                    </div>
                  )}
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('document_generators.page.external', 'External')}
                    </h3>
                    {moduleExternal.length > 0 ? (
                      <DataTable columns={columns} data={moduleExternal} disableRowClick />
                    ) : (
                      <EmptyState
                        size="sm"
                        variant="subtle"
                        title={t('document_generators.page.external_empty', 'No external templates registered.')}
                      />
                    )}
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}
      </PageBody>
    </Page>
  )
}
