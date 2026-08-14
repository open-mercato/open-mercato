'use client'

import * as React from 'react'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { FilterBarProps, FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import type { TemplateFilterOptions } from '../../lib/interfaces'
import type { DocumentTemplatesQuery } from './useDocumentTemplates'

const EMPTY_FILTER_OPTIONS: TemplateFilterOptions = {
  resourceKinds: [],
  formats: [],
}

export function buildDocumentTemplateFilterDefinitions(
  t: TranslateFn,
  options: TemplateFilterOptions,
): FilterDef[] {
  return [
    {
      id: 'resourceKind',
      label: t('document_generators.page.filters.resourceKind', 'Resource type'),
      type: 'select',
      options: options.resourceKinds.map((resourceKind) => ({ value: resourceKind, label: resourceKind })),
    },
    {
      id: 'format',
      label: t('document_generators.page.filters.format', 'Format'),
      type: 'select',
      options: options.formats.map((format) => ({ value: format, label: format.toUpperCase() })),
    },
  ]
}

export function documentTemplatesQueryFromFilterValues(values: FilterValues): DocumentTemplatesQuery {
  const resourceKind = typeof values.resourceKind === 'string' ? values.resourceKind : undefined
  const format = typeof values.format === 'string' ? values.format : undefined
  return { resourceKind, format }
}

export function useDocumentTemplateFilters(options: TemplateFilterOptions = EMPTY_FILTER_OPTIONS) {
  const t = useT()
  const [values, setValues] = React.useState<FilterValues>({})
  const filters = React.useMemo(
    () => buildDocumentTemplateFilterDefinitions(t, options),
    [options, t],
  )
  const query = React.useMemo(
    () => documentTemplatesQueryFromFilterValues(values),
    [values],
  )
  const clear = React.useCallback(() => setValues({}), [])

  const filterBarProps: Pick<FilterBarProps, 'filters' | 'values' | 'onApply' | 'onClear'> = {
    filters,
    values,
    onApply: setValues,
    onClear: clear,
  }

  return { query, filterBarProps }
}
