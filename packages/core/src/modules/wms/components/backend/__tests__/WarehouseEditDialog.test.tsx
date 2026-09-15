/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { E } from '#generated/entities.ids.generated'
import { WarehouseEditDialog, warehouseFormSchema, type WarehouseDialogRow } from '../WarehouseEditDialog'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback ?? _key,
  useLocale: () => 'en',
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: jest.fn(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  raiseCrudError: jest.fn(),
}))

jest.mock('../warehouseFormOptions', () => ({
  loadCountryOptions: jest.fn(async () => []),
  loadTimezoneOptions: jest.fn(async () => []),
  countryOptionFromStored: (value: string) => ({ value: value.toUpperCase(), label: value }),
  timezoneOptionFromStored: (value: string) => ({ value, label: value }),
}))

let capturedCrudFormProps: Record<string, unknown> | null = null

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => {
    capturedCrudFormProps = props
    return null
  },
}))

describe('WarehouseEditDialog', () => {
  beforeEach(() => {
    capturedCrudFormProps = null
  })

  it('reuses the same CrudForm entity and fields for create and edit', () => {
    const { rerender } = render(
      <WarehouseEditDialog open onOpenChange={jest.fn()} mode="create" row={null} />,
    )
    const createFields = capturedCrudFormProps?.fields as Array<{ id: string; type: string }>
    expect(capturedCrudFormProps?.entityId).toBe(E.wms.warehouse)
    expect(createFields.map((field) => field.id)).toEqual([
      'name',
      'code',
      'city',
      'country',
      'timezone',
      'isPrimary',
      'isActive',
    ])
    expect(createFields.find((field) => field.id === 'country')?.type).toBe('combobox')
    expect(createFields.find((field) => field.id === 'timezone')?.type).toBe('combobox')
    expect(capturedCrudFormProps?.optimisticLockUpdatedAt).toBeUndefined()

    const row: WarehouseDialogRow = {
      id: 'wh-1',
      name: 'Main DC',
      code: 'MAIN',
      city: 'Gdynia',
      country: 'PL',
      timezone: 'Europe/Warsaw',
      is_active: true,
      is_primary: false,
      updated_at: '2026-08-17T10:00:00.000Z',
    }
    rerender(
      <WarehouseEditDialog open onOpenChange={jest.fn()} mode="edit" row={row} />,
    )
    const editFields = capturedCrudFormProps?.fields as Array<{ id: string; type: string }>
    expect(capturedCrudFormProps?.entityId).toBe(E.wms.warehouse)
    expect(editFields.map((field) => field.id)).toEqual(createFields.map((field) => field.id))
    expect(capturedCrudFormProps?.optimisticLockUpdatedAt).toBe('2026-08-17T10:00:00.000Z')
  })

  it('seeds country and timezone labels in edit mode and hydrates custom fields', () => {
    const row: WarehouseDialogRow = {
      id: 'wh-1',
      name: 'Main DC',
      code: 'MAIN',
      country: 'PL',
      timezone: 'Europe/Warsaw',
      customValues: { dock_code: 'DOCK-A' },
    }

    render(
      <WarehouseEditDialog open onOpenChange={jest.fn()} mode="edit" row={row} />,
    )

    expect(capturedCrudFormProps?.disableInitialFocus).toBe(true)
    const fields = capturedCrudFormProps?.fields as Array<{
      id: string
      seedOptions?: Array<{ value: string; label: string }>
      allowCustomValues?: boolean
    }>
    expect(fields.find((field) => field.id === 'country')?.seedOptions).toEqual([
      { value: 'PL', label: 'PL' },
    ])
    expect(fields.find((field) => field.id === 'country')?.allowCustomValues).toBe(false)
    expect(fields.find((field) => field.id === 'timezone')?.seedOptions).toEqual([
      { value: 'Europe/Warsaw', label: 'Europe/Warsaw' },
    ])
    expect((capturedCrudFormProps?.initialValues as Record<string, unknown>).cf_dock_code).toBe('DOCK-A')
  })

  it('keeps custom-field keys on submit so CrudForm can persist them', () => {
    expect(
      warehouseFormSchema.parse({
        name: 'Main DC',
        code: 'MAIN',
        cf_dock_code: 'DOCK-A',
      }),
    ).toEqual(expect.objectContaining({
      name: 'Main DC',
      code: 'MAIN',
      cf_dock_code: 'DOCK-A',
    }))
  })
})
