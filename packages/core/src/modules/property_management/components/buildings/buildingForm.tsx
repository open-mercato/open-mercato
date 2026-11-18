"use client"

import * as React from 'react'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { BuildingRecord, FloorRow, ManagerRecord } from './buildingRecord'
import { FloorsEditor } from './FloorsEditor'
import { ManagersField } from './ManagersField'
import { findCountIssue, parseCount, parseMetres, readFloorRows, relayFloorRows } from './floorRows'
import { OpeningHoursEditor } from './OpeningHoursEditor'
import { openingHoursPayload, openingRowsOf, readOpeningRows, type OpeningRow } from './openingHoursRows'
import type { UnavailabilitiesState } from '../availability/useUnavailabilities'

export type BuildingFormValues = {
  id?: string
  name: string
  address: string
  managerUserIds: string[]
  below: number
  above: number
  floors: FloorRow[]
  openingHoursEnabled: boolean
  openingRows: OpeningRow[]
  updatedAt?: string | null
} & Record<string, unknown>

export type BuildingPayload = {
  id?: string
  name: string
  address: string
  managerUserIds?: string[]
  layout: { below: number; above: number; floors: Array<{ number: number; name: string; sizeX: number; sizeY: number }> }
  openingHoursEnabled: boolean
  openingHours: Array<{ weekday: number; opensAt: string; closesAt: string }>
  customFields?: Record<string, unknown>
}

export function createInitialValues(record: BuildingRecord | null): BuildingFormValues {
  if (!record) {
    return {
      name: '',
      address: '',
      managerUserIds: [],
      below: 0,
      above: 1,
      floors: relayFloorRows([], 0, 1),
      openingHoursEnabled: false,
      openingRows: openingRowsOf([]),
    }
  }
  return {
    id: record.id,
    name: record.name,
    address: record.address,
    managerUserIds: record.managers.map((manager) => manager.userId),
    below: record.floorsBelow,
    above: Math.max(1, record.floorsAbove),
    floors: record.floors,
    openingHoursEnabled: record.openingHoursEnabled,
    openingRows: openingRowsOf(record.openingHours, record.openingHoursEnabled),
    updatedAt: record.updatedAt,
    ...record.customFieldValues,
  }
}

export function useBuildingFormConfig(
  t: TranslateFn,
  options: {
    buildingId: string | null
    canManageAll: boolean
    managers: readonly ManagerRecord[]
    savedFloors: readonly FloorRow[]
    archived?: boolean
    availability?: UnavailabilitiesState
  },
): { fields: CrudField[]; groups: CrudFormGroup[] } {
  const { buildingId, canManageAll, managers, savedFloors, archived = false, availability } = options
  return React.useMemo(() => {
    const fields: CrudField[] = [
      {
        id: 'name',
        label: t('property_management.buildings.form.name', 'Building name'),
        type: 'text',
        required: true,
        placeholder: t('property_management.buildings.form.namePlaceholder', 'e.g. Cedar Hall'),
      },
      {
        id: 'address',
        label: t('property_management.buildings.form.address', 'Address'),
        type: 'text',
        required: true,
        placeholder: t('property_management.buildings.form.addressPlaceholder', 'Street and number, city'),
      },
      {
        id: 'managerUserIds',
        label: t('property_management.buildings.form.managers', 'Building managers'),
        type: 'custom',
        description: t(
          'property_management.buildings.form.managersHint',
          'Managers see and change only the buildings they are assigned to. Administrators see every building.',
        ),
        component: ({ value, setValue, disabled }) => (
          <ManagersField value={value} setValue={setValue} canManageAll={canManageAll} initialManagers={managers} disabled={disabled} />
        ),
      },
    ]
    const groups: CrudFormGroup[] = [
      {
        id: 'details',
        title: t('property_management.buildings.form.groupDetails', 'Building'),
        column: 1,
        fields: ['name', 'address', 'managerUserIds'],
      },
      {
        id: 'floors',
        title: t('property_management.buildings.form.groupFloors', 'Floors'),
        description: t('property_management.buildings.form.floorsHint', 'Give each floor a name and a size — units are laid out afterwards, on the floor page.'),
        column: 1,
        component: (ctx) => <FloorsEditor {...ctx} buildingId={buildingId} savedFloors={savedFloors} archived={archived} availability={availability} />,
      },
      {
        id: 'openingHours',
        title: t('property_management.buildings.form.groupHours', 'Opening hours'),
        column: 1,
        component: (ctx) => <OpeningHoursEditor {...ctx} />,
      },
      {
        id: 'customFields',
        title: t('entities.customFields.title', 'Custom fields'),
        column: 1,
        kind: 'customFields',
      },
    ]
    return { fields, groups }
  }, [archived, availability, buildingId, canManageAll, managers, savedFloors, t])
}

export function buildBuildingPayload(
  values: BuildingFormValues,
  t: TranslateFn,
  options: { savedFloors: readonly FloorRow[]; includeManagers: boolean },
): BuildingPayload {
  const below = parseCount(values.below, 0)
  const above = Math.max(1, parseCount(values.above, 1))
  const issue = findCountIssue(options.savedFloors, below, above)
  if (issue) {
    const message = t(
      'property_management.buildings.form.countBlocked',
      'Floor {number} ({name}) still has units on it, so this count cannot go below {minimum}.',
      { number: issue.floor.number, name: issue.floor.name, minimum: issue.minimum },
    )
    throw createCrudFormError(message, { [issue.field]: message })
  }
  const rows = relayFloorRows(readFloorRows(values.floors), below, above)
  const floors = rows.map((row) => {
    const sizeX = parseMetres(row.sizeX)
    const sizeY = parseMetres(row.sizeY)
    const name = row.name.trim()
    if (!name || sizeX === null || sizeY === null) {
      const message = t('property_management.buildings.form.floorIncomplete', 'Floor {number} needs a name and a size greater than 0.', { number: row.number })
      throw createCrudFormError(message, { floors: message })
    }
    return { number: row.number, name, sizeX, sizeY }
  })
  const opening = openingHoursPayload(readOpeningRows(values.openingRows))
  if (values.openingHoursEnabled === true && opening.invalidWeekday !== null) {
    const message = t('property_management.buildings.hours.orderError', 'Closing time must be after opening time (no overnight hours).')
    throw createCrudFormError(message, { openingRows: message })
  }
  const payload: BuildingPayload = {
    name: String(values.name ?? '').trim(),
    address: String(values.address ?? '').trim(),
    layout: { below, above, floors },
    openingHoursEnabled: values.openingHoursEnabled === true,
    openingHours: opening.entries,
  }
  if (values.id) payload.id = values.id
  const customFields = collectCustomFieldValues(values)
  if (Object.keys(customFields).length) payload.customFields = customFields
  if (options.includeManagers) {
    payload.managerUserIds = Array.isArray(values.managerUserIds) ? values.managerUserIds : []
  }
  return payload
}
