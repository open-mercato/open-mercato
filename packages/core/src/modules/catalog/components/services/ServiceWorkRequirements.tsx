"use client"

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  CATALOG_SERVICE_WORK_ALLOCATION_MODES,
  CATALOG_SERVICE_WORK_TARGET_TYPES,
  type CatalogServiceWorkAllocationMode,
  type CatalogServiceWorkTargetType,
} from '../../data/types'

export type ServiceWorkRequirementDraft = {
  id?: string
  targetType: CatalogServiceWorkTargetType
  targetId?: string | null
  labelSnapshot: string
  allocationMode: CatalogServiceWorkAllocationMode
  allocationValue: number | string
  sortOrder?: number
  metadata?: Record<string, unknown>
}

type LookupOption = {
  value: string
  label: string
}

type LookupState = Record<CatalogServiceWorkTargetType, LookupOption[]>

type Props = {
  value: ServiceWorkRequirementDraft[]
  onChange: (next: ServiceWorkRequirementDraft[]) => void
  showHeader?: boolean
}

type ApiListResponse = {
  items?: Array<Record<string, unknown>>
}

const lookupTargetTypes: CatalogServiceWorkTargetType[] = [
  'staff_team',
  'staff_role',
  'staff_member',
  'resource',
  'resource_type',
]

const emptyLookupState: LookupState = {
  staff_team: [],
  staff_role: [],
  staff_member: [],
  resource: [],
  resource_type: [],
  generic: [],
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function compactReference(id: string): string {
  return `#${id.slice(0, 8)}`
}

function joinedName(record: Record<string, unknown>): string | null {
  const first = text(record.firstName) ?? text(record.first_name) ?? text(record.givenName) ?? text(record.given_name)
  const last = text(record.lastName) ?? text(record.last_name) ?? text(record.familyName) ?? text(record.family_name)
  return text([first, last].filter(Boolean).join(' '))
}

function readDirectLabel(record: Record<string, unknown>): string | null {
  return text(record.name) ??
    text(record.displayName) ??
    text(record.display_name) ??
    text(record.fullName) ??
    text(record.full_name) ??
    joinedName(record) ??
    text(record.title) ??
    text(record.label) ??
    text(record.email)
}

function readLabel(record: Record<string, unknown>, fallback: string): string {
  const direct = readDirectLabel(record)
  if (direct) return direct

  for (const key of ['user', 'team', 'role', 'resource', 'resourceType', 'resource_type']) {
    const nested = objectValue(record[key])
    const nestedLabel = nested ? readDirectLabel(nested) : null
    if (nestedLabel) return nestedLabel
  }

  return compactReference(fallback)
}

async function loadOptions(path: string): Promise<LookupOption[]> {
  const call = await apiCall<ApiListResponse>(`${path}?page=1&pageSize=100`)
  const items = Array.isArray(call.result?.items) ? call.result.items : []
  return items
    .map((item) => {
      const id = text(item.id)
      if (!id) return null
      return { value: id, label: readLabel(item, id) }
    })
    .filter((entry): entry is LookupOption => entry !== null)
}

function targetTypeLabel(t: ReturnType<typeof useT>, type: CatalogServiceWorkTargetType): string {
  const labels: Record<CatalogServiceWorkTargetType, string> = {
    staff_team: t('catalog.services.work.target.staffTeam', 'Staff team'),
    staff_role: t('catalog.services.work.target.staffRole', 'Staff role'),
    staff_member: t('catalog.services.work.target.staffMember', 'Staff member'),
    resource: t('catalog.services.work.target.resource', 'Resource'),
    resource_type: t('catalog.services.work.target.resourceType', 'Resource type'),
    generic: t('catalog.services.work.target.generic', 'Generic'),
  }
  return labels[type]
}

function allocationModeLabel(t: ReturnType<typeof useT>, mode: CatalogServiceWorkAllocationMode): string {
  return mode === 'ratio'
    ? t('catalog.services.work.allocation.ratio', 'Ratio')
    : t('catalog.services.work.allocation.fixedHours', 'Fixed hours')
}

function createRequirement(sortOrder: number): ServiceWorkRequirementDraft {
  return {
    targetType: 'generic',
    targetId: null,
    labelSnapshot: '',
    allocationMode: 'ratio',
    allocationValue: 1,
    sortOrder,
    metadata: {},
  }
}

function allocationInputValue(value: ServiceWorkRequirementDraft['allocationValue']): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'string') return value
  return ''
}

export function ServiceWorkRequirements({ value, onChange, showHeader = true }: Props) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [lookups, setLookups] = React.useState<LookupState>(emptyLookupState)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      const results = await Promise.allSettled([
        loadOptions('/api/staff/teams'),
        loadOptions('/api/staff/team-roles'),
        loadOptions('/api/staff/team-members'),
        loadOptions('/api/resources/resources'),
        loadOptions('/api/resources/resource-types'),
      ])
      if (cancelled) return
      setLookups({
        staff_team: results[0].status === 'fulfilled' ? results[0].value : [],
        staff_role: results[1].status === 'fulfilled' ? results[1].value : [],
        staff_member: results[2].status === 'fulfilled' ? results[2].value : [],
        resource: results[3].status === 'fulfilled' ? results[3].value : [],
        resource_type: results[4].status === 'fulfilled' ? results[4].value : [],
        generic: [],
      })
    }
    load()
    return () => {
      cancelled = true
    }
  }, [scopeVersion])

  const rows = Array.isArray(value) ? value : []

  const updateRow = React.useCallback((index: number, patch: Partial<ServiceWorkRequirementDraft>) => {
    const next = rows.map((row, rowIndex) => {
      if (rowIndex !== index) return row
      const updated = { ...row, ...patch, sortOrder: rowIndex }
      if (patch.targetType) {
        updated.targetId = null
        updated.labelSnapshot = ''
      }
      if (patch.targetId) {
        const option = lookups[updated.targetType]?.find((entry) => entry.value === patch.targetId)
        if (option) updated.labelSnapshot = option.label
      }
      return updated
    })
    onChange(next)
  }, [lookups, onChange, rows])

  const addRow = React.useCallback(() => {
    onChange([...rows, createRequirement(rows.length)])
  }, [onChange, rows])

  const removeRow = React.useCallback((index: number) => {
    onChange(rows.filter((_row, rowIndex) => rowIndex !== index).map((row, sortOrder) => ({ ...row, sortOrder })))
  }, [onChange, rows])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          {showHeader ? (
            <h3 className="text-sm font-medium">{t('catalog.services.work.title', 'Work requirements')}</h3>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {t('catalog.services.work.description', 'Store decoupled staff and resource references with label snapshots.')}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="mr-2 h-4 w-4" />
          {t('catalog.services.work.actions.add', 'Add')}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {t('catalog.services.work.empty', 'No work requirements yet.')}
        </p>
      ) : null}

      <div className="space-y-3">
        {rows.map((row, index) => {
          const targetOptions = lookups[row.targetType] ?? []
          return (
            <div key={`${row.id ?? 'new'}-${index}`} className="rounded-md border p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-[minmax(7rem,0.8fr)_minmax(12rem,1.2fr)_minmax(14rem,1.5fr)_minmax(7rem,0.8fr)_minmax(5.5rem,0.6fr)_2rem]">
                <label className="min-w-0 space-y-1 text-xs font-medium text-muted-foreground">
                  <span>{t('catalog.services.work.field.targetType', 'Target')}</span>
                  <select
                    className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
                    value={row.targetType}
                    onChange={(event) => {
                      const nextType = event.target.value as CatalogServiceWorkTargetType
                      if (CATALOG_SERVICE_WORK_TARGET_TYPES.includes(nextType)) {
                        updateRow(index, { targetType: nextType })
                      }
                    }}
                  >
                    {CATALOG_SERVICE_WORK_TARGET_TYPES.map((type) => (
                      <option key={type} value={type}>{targetTypeLabel(t, type)}</option>
                    ))}
                  </select>
                </label>

                <label className="min-w-0 space-y-1 text-xs font-medium text-muted-foreground">
                  <span>{t('catalog.services.work.field.label', 'Label')}</span>
                  <input
                    className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
                    value={row.labelSnapshot}
                    onChange={(event) => updateRow(index, { labelSnapshot: event.target.value })}
                  />
                </label>

                {row.targetType === 'generic' ? null : (
                  <label className="min-w-0 space-y-1 text-xs font-medium text-muted-foreground">
                    <span>{t('catalog.services.work.field.reference', 'Reference')}</span>
                    <select
                      className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
                      value={row.targetId ?? ''}
                      onChange={(event) => updateRow(index, { targetId: event.target.value || null })}
                    >
                      <option value="">{t('catalog.services.work.field.referenceEmpty', 'Select')}</option>
                      {targetOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="min-w-0 space-y-1 text-xs font-medium text-muted-foreground">
                  <span>{t('catalog.services.work.field.allocationMode', 'Mode')}</span>
                  <select
                    className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
                    value={row.allocationMode}
                    onChange={(event) => {
                      const nextMode = event.target.value as CatalogServiceWorkAllocationMode
                      if (CATALOG_SERVICE_WORK_ALLOCATION_MODES.includes(nextMode)) {
                        updateRow(index, { allocationMode: nextMode })
                      }
                    }}
                  >
                    {CATALOG_SERVICE_WORK_ALLOCATION_MODES.map((mode) => (
                      <option key={mode} value={mode}>{allocationModeLabel(t, mode)}</option>
                    ))}
                  </select>
                </label>

                <label className="min-w-0 space-y-1 text-xs font-medium text-muted-foreground">
                  <span>{t('catalog.services.work.field.value', 'Value')}</span>
                  <input
                    className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
                    type="text"
                    inputMode="decimal"
                    value={allocationInputValue(row.allocationValue)}
                    onChange={(event) => updateRow(index, { allocationValue: event.target.value })}
                  />
                </label>

                <div className="flex min-w-0 items-end justify-end sm:col-span-2 2xl:col-span-1 2xl:col-start-6">
                  <IconButton variant="ghost" size="default" onClick={() => removeRow(index)} aria-label={t('catalog.services.work.actions.remove', 'Remove')}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
