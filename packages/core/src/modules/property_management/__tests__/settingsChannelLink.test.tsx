/** @jest-environment jsdom */
import * as React from 'react'
import { screen } from '@testing-library/react'
import type { CrudCustomFieldRenderProps, CrudField } from '@open-mercato/ui/backend/CrudForm'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const mockGrantedFeatures: { current: string[] } = { current: [] }
const mockApiCall = jest.fn()

type CustomField = CrudField & { component?: (props: CrudCustomFieldRenderProps) => React.ReactNode }

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: mockGrantedFeatures.current } }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/apiCall'),
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))
jest.mock('../components/settings/salesOptions', () => ({ loadSalesOptions: jest.fn(async () => []) }))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ fields }: { fields: CustomField[] }) => {
    const channel = fields.find((field) => field.id === 'billingChannelId')
    return <form>{channel?.component?.({ id: 'billingChannelId', value: '', setValue: () => undefined, disabled: false } as CrudCustomFieldRenderProps)}</form>
  },
}))

import { SettingsPage } from '../components/settings/SettingsPage'

function respond() {
  mockApiCall.mockResolvedValue({
    ok: true,
    status: 200,
    result: { billingChannelId: null, cancelledOrderStatusEntryId: null, leaseEndingThresholdDays: 60, bookingReminderMinutes: 60, proposalExpiryDays: 14, updatedAt: null, canEdit: true },
  })
}

describe('settings sales channel empty-state link', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    respond()
  })

  it('links to the sales channels page for a viewer who can manage channels', async () => {
    mockGrantedFeatures.current = ['property_management.*', 'sales.channels.manage']
    renderWithProviders(<SettingsPage />)
    const empty = await screen.findByTestId('pm-settings-billingChannelId-empty')
    expect(empty.querySelector('a')).toHaveAttribute('href', '/backend/sales/channels')
  })

  it('shows the empty message without a link when the viewer cannot open the sales channels page', async () => {
    mockGrantedFeatures.current = ['property_management.*', 'sales.orders.view']
    renderWithProviders(<SettingsPage />)
    const empty = await screen.findByTestId('pm-settings-billingChannelId-empty')
    expect(empty).toHaveTextContent('No sales channel exists yet.')
    expect(empty.querySelector('a')).toBeNull()
  })
})
