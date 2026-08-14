'use client'

import React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { FilterBar } from '@open-mercato/ui/backend/FilterBar'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { useDocumentTemplateFilters } from '../../../hooks/templates/useDocumentTemplateFilters'
import { useDocumentTemplateOptions } from '../../../hooks/templates/useDocumentTemplateOptions'
import { useDocumentTemplates } from '../../../hooks/templates/useDocumentTemplates'
import { groupTemplatesByModule } from '../../../utils/groupTemplatesByModule'
import { buildTemplatesDataTableColumns } from './components/TemplatesDatatableColumns'

export default function DocumentGeneratorTemplatesPage() {
  const t = useT()
  const columns = React.useMemo(() => buildTemplatesDataTableColumns(t), [t])
  const optionsQuery = useDocumentTemplateOptions()
  const templateFilters = useDocumentTemplateFilters(optionsQuery.data)
  const templatesQuery = useDocumentTemplates(templateFilters.query)
  const templates = templatesQuery.data ?? []
  const isLoading = optionsQuery.isLoading || templatesQuery.isLoading
  const error = optionsQuery.error ?? templatesQuery.error

  const grouped = groupTemplatesByModule(templates)
  const errorMessage = error
    ? t('document_generators.page.error', 'Failed to load templates.')
    : null

  return (
    <Page data-testid="document-generators-templates-page">
      <PageHeader
        title={t('document_generators.page.title', 'Available templates')}
        description={t(
          'document_generators.page.description',
          'Registered document templates available in this application.',
        )}
      />
      <PageBody className="space-y-6">
        <FilterBar {...templateFilters.filterBarProps} />
        {isLoading || errorMessage ? (
          <DataTable columns={columns} data={[]} isLoading={isLoading} error={errorMessage} disableRowClick />
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
