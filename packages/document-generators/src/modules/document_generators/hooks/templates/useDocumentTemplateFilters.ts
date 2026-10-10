'use client'

import * as React from 'react'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DocumentTemplatesFilter } from '../document-queries'
import type { DocumentTemplateOptions } from './useDocumentTemplateOptions'

export function buildDocumentTemplateFilterDefs(
  options: DocumentTemplateOptions | undefined,
  labels: { resourceKind: string; format: string },
): FilterDef[] {
  return [
    {
      id: 'resourceKind',
      label: labels.resourceKind,
      type: 'select',
      options: (options?.resourceKinds ?? []).map((value) => ({ value, label: value })),
    },
    {
      id: 'format',
      label: labels.format,
      type: 'select',
      options: (options?.formats ?? []).map((value) => ({ value, label: value.toUpperCase() })),
    },
  ]
}

export function useDocumentTemplateFilters(options: DocumentTemplateOptions | undefined) {
  const t = useT()
  const [values, setValues] = React.useState<FilterValues>({})
  const resourceTypeLabel = t('document_generators.page.filters.resourceKind')
  const formatLabel = t('document_generators.page.filters.format')

  const filters = React.useMemo(
    () => buildDocumentTemplateFilterDefs(options, { resourceKind: resourceTypeLabel, format: formatLabel }),
    [options, resourceTypeLabel, formatLabel],
  )

  const filter = React.useMemo<DocumentTemplatesFilter>(
    () => ({
      resourceKind: typeof values.resourceKind === 'string' ? values.resourceKind : undefined,
      format: typeof values.format === 'string' ? values.format : undefined,
    }),
    [values],
  )

  const reset = React.useCallback(() => setValues({}), [])

  return { filters, values, setValues, filter, reset }
}
