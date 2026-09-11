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

function mockOptions() {
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
            runParameters: [],
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

function intervalInput() {
  return screen.getByRole('textbox', { name: /interval/i })
}

function saveButton() {
  return screen.getByRole('button', { name: /save recurring schedule/i })
}

describe('IntegrationScheduleTab — schedule value validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOptions()
    runMutationMock.mockResolvedValue({ ok: true, result: null })
  })

  it('blocks the save and marks the field invalid when the interval has no unit', async () => {
    await renderTab()

    fireEvent.change(intervalInput(), { target: { value: '3600' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(intervalInput()).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByText(/whole number followed by s, m, h or d/i)).toBeInTheDocument()
    expect(runMutationMock).not.toHaveBeenCalled()
    expect(flashMock).not.toHaveBeenCalled()
  })

  it('clears the inline error once the value is corrected and submits the trimmed value', async () => {
    runMutationMock.mockResolvedValue({
      ok: true,
      result: {
        id: 'schedule-1',
        scheduleType: 'interval',
        scheduleValue: '2h',
        timezone: 'UTC',
        fullSync: false,
        isEnabled: true,
        lastRunAt: null,
        updatedAt: null,
      },
    })
    await renderTab()

    fireEvent.change(intervalInput(), { target: { value: '3600' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(intervalInput()).toHaveAttribute('aria-invalid', 'true'))

    fireEvent.change(intervalInput(), { target: { value: ' 2h ' } })
    expect(intervalInput()).not.toHaveAttribute('aria-invalid')

    fireEvent.click(saveButton())
    await waitFor(() => expect(runMutationMock).toHaveBeenCalled())
    expect(runMutationMock.mock.calls[0][0].mutationPayload.scheduleValue).toBe('2h')
  })

  it('distinguishes an empty value from a malformed one', async () => {
    await renderTab()

    fireEvent.change(intervalInput(), { target: { value: '   ' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(intervalInput()).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByText(/provide a schedule value/i)).toBeInTheDocument()
    expect(runMutationMock).not.toHaveBeenCalled()
  })

  it('drops a stale inline error when the tab reloads', async () => {
    await renderTab()

    fireEvent.change(intervalInput(), { target: { value: '3600' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(intervalInput()).toHaveAttribute('aria-invalid', 'true'))

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => expect(intervalInput()).not.toHaveAttribute('aria-invalid'))
  })

  it('renders a server-reported scheduleValue error inline instead of flashing it', async () => {
    runMutationMock.mockResolvedValue({
      ok: false,
      status: 422,
      result: {
        error: 'Invalid payload',
        details: { formErrors: [], fieldErrors: { scheduleValue: ['Cron expression could not be parsed.'] } },
      },
    })
    await renderTab()

    fireEvent.click(saveButton())

    await waitFor(() => expect(intervalInput()).toHaveAttribute('aria-invalid', 'true'))
    expect(flashMock).not.toHaveBeenCalled()
  })
})
