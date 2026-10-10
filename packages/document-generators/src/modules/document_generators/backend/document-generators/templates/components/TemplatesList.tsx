"use client"

import * as React from 'react'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { FilterBar } from '@open-mercato/ui/backend/FilterBar'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useDocumentTemplates } from '../../../../hooks/templates/useDocumentTemplates'
import { useDocumentTemplateOptions } from '../../../../hooks/templates/useDocumentTemplateOptions'
import { useDocumentTemplateFilters } from '../../../../hooks/templates/useDocumentTemplateFilters'
import { buildTemplateColumns, groupTemplatesForCatalogue } from './TemplatesListTableColumns'
import { formatModuleLabel } from '../../../../utils/groupTemplatesByModule'

export function TemplatesList() {
  const t = useT()
  const options = useDocumentTemplateOptions()
  const { filters, values, setValues, filter, reset } = useDocumentTemplateFilters(options.data)
  const templates = useDocumentTemplates(filter)

  const columns = React.useMemo(() => buildTemplateColumns(t), [t])
  const groups = React.useMemo(() => groupTemplatesForCatalogue(templates.data ?? []), [templates.data])
  const errorMessage = templates.isError ? t('document_generators.page.error') : null

  return (
    <div className="space-y-6">
      <FilterBar filters={filters} values={values} onApply={setValues} onClear={reset} />
      {groups.length === 0 ? (
        <DataTable
          title={t('document_generators.page.title')}
          columns={columns}
          data={[]}
          isLoading={templates.isFetching}
          error={errorMessage}
          emptyState={<p className="py-6 text-center text-sm text-muted-foreground">{t('document_generators.page.empty')}</p>}
        />
      ) : (
        groups.map(([moduleId, moduleTemplates]) => (
          <DataTable
            key={moduleId}
            title={formatModuleLabel(moduleId, t)}
            columns={columns}
            data={moduleTemplates}
            isLoading={templates.isFetching}
            error={errorMessage}
          />
        ))
      )}
    </div>
  )
}
