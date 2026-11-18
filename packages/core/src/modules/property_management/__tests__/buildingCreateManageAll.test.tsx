/** @jest-environment jsdom */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const mockChrome: { current: { payload: { grantedFeatures: string[] } | null; isReady: boolean } } = {
  current: { payload: null, isReady: true },
}
const mockApiCall = jest.fn()
const mockFormConfig = jest.fn((_t: unknown, _options: { canManageAll: boolean }) => ({ fields: [], groups: [] }))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => mockChrome.current,
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/apiCall'),
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => <form data-testid="building-create-form" />,
}))
jest.mock('../components/buildings/buildingForm', () => ({
  useBuildingFormConfig: (t: unknown, options: { canManageAll: boolean }) => mockFormConfig(t, options),
  createInitialValues: () => ({}),
  buildBuildingPayload: () => ({}),
}))

import { BuildingCreatePage } from '../components/buildings/BuildingCreatePage'

function lastCanManageAll(): boolean | undefined {
  const calls = mockFormConfig.mock.calls
  return calls.length ? calls[calls.length - 1][1].canManageAll : undefined
}

describe('building create page managers access', () => {
  beforeEach(() => {
    mockFormConfig.mockClear()
    mockApiCall.mockReset()
  })

  it('reads manage_all from the granted features, wildcards included, without probing the list API', () => {
    mockChrome.current = { payload: { grantedFeatures: ['property_management.*'] }, isReady: true }
    renderWithProviders(<BuildingCreatePage />)
    expect(screen.getByTestId('building-create-form')).toBeTruthy()
    expect(lastCanManageAll()).toBe(true)
    expect(mockApiCall).not.toHaveBeenCalled()
  })

  it('hides the managers field from a user without manage_all', () => {
    mockChrome.current = { payload: { grantedFeatures: ['property_management.view', 'property_management.manage'] }, isReady: true }
    renderWithProviders(<BuildingCreatePage />)
    expect(lastCanManageAll()).toBe(false)
  })

  it('waits for the granted features before showing the form, so an early save cannot drop managers', () => {
    mockChrome.current = { payload: null, isReady: false }
    renderWithProviders(<BuildingCreatePage />)
    expect(screen.queryByTestId('building-create-form')).toBeNull()
    expect(screen.getByText('Loading…')).toBeTruthy()
  })
})
