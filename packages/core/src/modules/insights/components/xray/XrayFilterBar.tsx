"use client"

import * as React from 'react'
import { CAUSE_KINDS } from '@open-mercato/shared/lib/causation/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FilterBar, type FilterDef, type FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { EMPTY_XRAY_FILTERS, type XrayFilterState } from '../../lib/client/xray/api'
import { shortId } from '../../lib/client/xray/format'
import { loadRoleOptions, loadTeamOptions, type XrayLabelOption } from '../../lib/client/xray/labels'

export const XRAY_LEGACY_CAUSE_KIND = 'legacy'

const FILTER_CAUSE_KINDS = [...CAUSE_KINDS.filter((kind) => kind !== 'unknown'), XRAY_LEGACY_CAUSE_KIND]

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

export function filtersFromValues(values: FilterValues): XrayFilterState {
  return {
    causeKinds: stringArray(values.causeKinds),
    includeSyncRun: values.includeSyncRun === true,
    actorRoleIds: stringArray(values.actorRoleIds),
    actorTeamIds: stringArray(values.actorTeamIds),
  }
}

export function valuesFromFilters(filters: XrayFilterState): FilterValues {
  const values: FilterValues = {}
  if (filters.causeKinds.length > 0) values.causeKinds = filters.causeKinds
  if (filters.includeSyncRun) values.includeSyncRun = true
  if (filters.actorRoleIds.length > 0) values.actorRoleIds = filters.actorRoleIds
  if (filters.actorTeamIds.length > 0) values.actorTeamIds = filters.actorTeamIds
  return values
}

export function causeKindLabelKey(kind: string): string {
  return kind === XRAY_LEGACY_CAUSE_KIND ? 'insights.xray.ui.cause.legacyKind' : `insights.explain.causeKinds.${kind}`
}

export type XrayFilterBarProps = {
  filters: XrayFilterState
  onChange: (next: XrayFilterState) => void
  leadingItems?: React.ReactNode
  trailingItems?: React.ReactNode
}

/**
 * Cause-kind, sync-run and actor (role / team) filters of the per-process analytics, on the
 * shared `FilterBar`. Role and team names come from the owning modules' lists (best effort);
 * a filter that would single out a small group is refused by the API (`filter_too_narrow`).
 */
export function XrayFilterBar({ filters, onChange, leadingItems, trailingItems }: XrayFilterBarProps) {
  const t = useT()
  const labelsRef = React.useRef<Map<string, string>>(new Map())
  const remember = React.useCallback((options: XrayLabelOption[]) => {
    for (const option of options) labelsRef.current.set(option.value, option.label)
    return options
  }, [])
  const formatId = React.useCallback((value: string) => labelsRef.current.get(value.toLowerCase()) ?? shortId(value), [])

  const definitions = React.useMemo<FilterDef[]>(() => [
    {
      id: 'causeKinds',
      label: t('insights.xray.ui.filters.causeKinds'),
      type: 'select',
      multiple: true,
      options: FILTER_CAUSE_KINDS.map((kind) => ({ value: kind, label: t(causeKindLabelKey(kind)) })),
    },
    {
      id: 'includeSyncRun',
      label: t('insights.xray.ui.filters.includeSyncRun'),
      tooltip: t('insights.xray.ui.filters.includeSyncRunHelp'),
      type: 'checkbox',
    },
    {
      id: 'actorRoleIds',
      label: t('insights.xray.ui.filters.roles'),
      tooltip: t('insights.xray.ui.filters.actorHelp'),
      type: 'select',
      multiple: true,
      loadOptions: async () => remember(await loadRoleOptions()),
      formatValue: formatId,
    },
    {
      id: 'actorTeamIds',
      label: t('insights.xray.ui.filters.teams'),
      tooltip: t('insights.xray.ui.filters.actorHelp'),
      type: 'select',
      multiple: true,
      loadOptions: async () => remember(await loadTeamOptions()),
      formatValue: formatId,
    },
  ], [formatId, remember, t])

  const values = React.useMemo(() => valuesFromFilters(filters), [filters])
  return (
    <FilterBar
      filters={definitions}
      values={values}
      onApply={(next) => onChange(filtersFromValues(next))}
      onClear={() => onChange(EMPTY_XRAY_FILTERS)}
      leadingItems={leadingItems}
      trailingItems={trailingItems}
      layout="inline"
    />
  )
}
