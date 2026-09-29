/**
 * @jest-environment jsdom
 *
 * The workflow-command settings page.
 *
 * The properties that matter are structural rather than cosmetic: the page
 * offers TICK-BOXES OVER A CODE-DECLARED CATALOGUE and nothing else — there is
 * no free-text command field, because an administrator who could type an id
 * would reach commands nobody designed for unattended execution. Each row must
 * name the command id and the permission it requires, and the save must send
 * the complete set through the guarded mutation path.
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { CommandSettingsPageClient } from '../settings/CommandSettingsPageClient'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

const apiCallMock = apiCall as jest.Mock
const readApiResultOrThrowMock = readApiResultOrThrow as jest.Mock

const items = [
  {
    commandId: 'sales.orders.update',
    requiredFeatures: ['sales.orders.manage'],
    labelKey: null,
    enabled: true,
    defaultEnabled: true,
  },
  {
    commandId: 'customers.deals.update',
    requiredFeatures: ['customers.deals.manage'],
    labelKey: null,
    enabled: false,
    defaultEnabled: false,
  },
]

async function renderPage(configured = false) {
  readApiResultOrThrowMock.mockResolvedValue({ configured, items })
  await act(async () => {
    renderWithProviders(<CommandSettingsPageClient />)
  })
}

beforeEach(() => {
  apiCallMock.mockReset()
  readApiResultOrThrowMock.mockReset()
  apiCallMock.mockResolvedValue({ ok: true, result: { configured: true, items } })
})

describe('CommandSettingsPageClient', () => {
  it('renders one tick-box per candidate, grouped by the owning module', async () => {
    await renderPage()

    expect(screen.getByText('customers')).toBeInTheDocument()
    expect(screen.getByText('sales')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('shows each command id and the permission it requires', async () => {
    await renderPage()

    expect(screen.getAllByText('customers.deals.update').length).toBeGreaterThan(0)
    expect(screen.getByText(/customers\.deals\.manage/)).toBeInTheDocument()
    expect(screen.getByText(/sales\.orders\.manage/)).toBeInTheDocument()
  })

  it('reflects the tenant answers: grandfathered on, new candidate off', async () => {
    await renderPage()

    const checkboxes = screen.getAllByRole('checkbox')
    const states = checkboxes.map((box) => box.getAttribute('data-state') ?? box.getAttribute('aria-checked'))
    expect(states).toContain('checked')
    expect(states).toContain('unchecked')
  })

  it('offers no free-text field for a command id', async () => {
    await renderPage()

    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('sends the complete enabled set on save', async () => {
    await renderPage()

    const deals = screen
      .getAllByRole('checkbox')
      .find((box) => box.closest('div')?.textContent?.includes('customers.deals.update'))
    await act(async () => {
      fireEvent.click(deals as HTMLElement)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'workflows.commandSettings.save' }))
    })

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledWith(
        '/api/workflows/command-settings',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
    const [, init] = apiCallMock.mock.calls[0]
    expect(JSON.parse(init.body).enabledCommandIds.sort()).toEqual([
      'customers.deals.update',
      'sales.orders.update',
    ])
  })

  it('says so when the tenant has never saved the setting', async () => {
    await renderPage(false)
    expect(screen.getByText('workflows.commandSettings.notConfiguredHint')).toBeInTheDocument()
  })

  it('hides that note once the tenant has saved', async () => {
    await renderPage(true)
    expect(screen.queryByText('workflows.commandSettings.notConfiguredHint')).toBeNull()
  })
})
