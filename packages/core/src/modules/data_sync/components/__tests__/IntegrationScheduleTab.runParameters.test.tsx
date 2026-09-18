/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()
const flashMock = jest.fn()
const runMutationMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (_header: unknown, fn: () => unknown) => fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: runMutationMock, retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))

function mockOptions(runParameters: unknown[]) {
  apiCallMock.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/data_sync/options')) {
      return Promise.resolve({
        ok: true,
        result: {
          items: [{
            integrationId: 'sync_demo',
            title: 'Demo',
            direction: 'import',
            runMode: 'generic',
            canStartRun: true,
            supportedEntities: ['orders'],
            runParameters,
            hasCredentials: true,
            isEnabled: true,
          }],
        },
      })
    }
    return Promise.resolve({ ok: true, result: { items: [] } })
  })
}

async function renderTab() {
  const { IntegrationScheduleTab } = await import('../IntegrationScheduleTab')
  renderWithProviders(
    <IntegrationScheduleTab integrationId="sync_demo" hasCredentials isEnabled />,
  )
  await waitFor(() => expect(screen.getByText('Orders')).toBeInTheDocument())
}

describe('IntegrationScheduleTab — run parameters', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    runMutationMock.mockResolvedValue({ ok: true, result: { id: 'run-1' } })
  })

  it('refuses the run and issues no request when a required parameter has no default', async () => {
    // The table row has no parameter form, so a value only the operator can
    // supply must send them to the dashboard rather than produce a bare 422.
    mockOptions([{ key: 'cursor', label: 'Cursor', type: 'string', required: true }])
    await renderTab()

    fireEvent.click(screen.getByRole('button', { name: /run now/i }))

    await waitFor(() => expect(flashMock).toHaveBeenCalled())
    expect(flashMock.mock.calls[0][1]).toBe('error')
    expect(runMutationMock).not.toHaveBeenCalled()
  })

  it('submits the declared defaults when every applicable parameter has one', async () => {
    mockOptions([
      { key: 'dryRun', label: 'Dry run', type: 'boolean', defaultValue: false },
      { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'fast' }], defaultValue: 'fast' },
    ])
    await renderTab()

    fireEvent.click(screen.getByRole('button', { name: /run now/i }))

    await waitFor(() => expect(runMutationMock).toHaveBeenCalled())
    const payload = runMutationMock.mock.calls[0][0].mutationPayload
    expect(payload.parameters).toEqual({ dryRun: false, mode: 'fast' })
  })

  it('omits parameters entirely when the adapter declares none', async () => {
    mockOptions([])
    await renderTab()

    fireEvent.click(screen.getByRole('button', { name: /run now/i }))

    await waitFor(() => expect(runMutationMock).toHaveBeenCalled())
    expect(runMutationMock.mock.calls[0][0].mutationPayload).not.toHaveProperty('parameters')
  })
})
