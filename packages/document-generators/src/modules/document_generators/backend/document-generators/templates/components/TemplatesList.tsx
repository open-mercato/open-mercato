'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { FilterBar } from '@open-mercato/ui/backend/FilterBar'
import { useDocumentTemplateFilters } from '../../../../hooks/templates/useDocumentTemplateFilters'
import { useDocumentTemplateOptions } from '../../../../hooks/templates/useDocumentTemplateOptions'
import { useDocumentTemplates } from '../../../../hooks/templates/useDocumentTemplates'
import { groupTemplatesByModule } from '../../../../utils/groupTemplatesByModule'
import { buildTemplatesListTableColumns } from './TemplatesListTableColumns'

export function TemplatesList() {
  const t = useT()
  const columns = React.useMemo(() => buildTemplatesListTableColumns(t), [t])
  const optionsQuery = useDocumentTemplateOptions()
  const templateFilters = useDocumentTemplateFilters(optionsQuery.data)
  const templatesQuery = useDocumentTemplates(templateFilters.query)
  const grouped = groupTemplatesByModule(templatesQuery.data ?? [])
  const isLoading = optionsQuery.isLoading || templatesQuery.isLoading
  const error = optionsQuery.error ?? templatesQuery.error
  const errorMessage = error
    ? t('document_generators.page.error', 'Failed to load templates.')
    : null

  return (
    <div className="space-y-6">
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
    </div>
  )
}
