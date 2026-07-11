/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { LocationEditDialog, type LocationDialogRow } from '../LocationEditDialog'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback ?? _key,
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

jest.mock('../wmsLookupLoaders', () => ({
  loadWarehouseOptions: jest.fn(async () => []),
}))

let capturedCrudFormProps: Record<string, unknown> | null = null

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => {
    capturedCrudFormProps = props
    return null
  },
}))

describe('LocationEditDialog', () => {
  beforeEach(() => {
    capturedCrudFormProps = null
  })

  it('passes the loaded row updatedAt to CrudForm as optimisticLockUpdatedAt in edit mode (#4106 follow-up)', () => {
    const row: LocationDialogRow = {
      id: 'loc-1',
      warehouse_id: 'wh-1',
      code: 'A-01',
      type: 'bin',
      is_active: true,
      updated_at: '2026-07-01T10:00:00.000Z',
    }

    render(
      <LocationEditDialog open onOpenChange={jest.fn()} mode="edit" row={row} onSaved={jest.fn()} />,
    )

    expect(capturedCrudFormProps?.optimisticLockUpdatedAt).toBe('2026-07-01T10:00:00.000Z')
  })

  it('does not send a lock header in create mode', () => {
    render(
      <LocationEditDialog open onOpenChange={jest.fn()} mode="create" row={null} onSaved={jest.fn()} />,
    )

    expect(capturedCrudFormProps?.optimisticLockUpdatedAt).toBeUndefined()
  })
})
