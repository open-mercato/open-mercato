import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import customerPolish from '@open-mercato/core/modules/customers/i18n/pl.json'
import staffPolish from '@open-mercato/core/modules/staff/i18n/pl.json'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { AddressTiles, type AddressValue } from '../AddressTiles'
import { AddressesSection, type AddressDataAdapter, type AddressSummary } from '../AddressesSection'
import type { AddressTypeOption, AddressTypesAdapter } from '../AddressEditor'

const mockReportError = jest.fn()
let mockTelemetryRuntime: { reportError: typeof mockReportError } | undefined

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => mockTelemetryRuntime,
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/staff/team-members/member-1',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div role="status">{label}</div>,
  TabEmptyState: ({ action }: { action: { label: string; onClick: () => void } }) => (
    <Button type="button" onClick={action.onClick}>{action.label}</Button>
  ),
}))
jest.mock('../../injection/useRegisteredComponent', () => ({
  useRegisteredComponent: (_handle: string, fallback: React.ComponentType) => fallback,
}))

const customerTranslator = createFallbackTranslator(customerPolish)
const address: AddressValue = { id: 'address-1', name: 'Biuro W47', purpose: 'office', addressLine1: 'Długa 1' }
const emptyAdapter: AddressDataAdapter = {
  list: async () => [],
  create: async () => undefined,
  update: async () => undefined,
  delete: async () => undefined,
}

function tiles(adapter?: AddressTypesAdapter<string>, context?: string) {
  return (
    <AddressTiles
      addresses={[address, { ...address, id: 'address-2', name: 'Custom', purpose: 'legacy-type' }]}
      onCreate={async () => undefined}
      t={customerTranslator}
      emptyLabel="Brak adresów"
      addressTypesAdapter={adapter}
      addressTypesContext={context}
    />
  )
}

function section(prefix: string, adapter = emptyAdapter) {
  return (
    <AddressesSection
      entityId="member-1"
      emptyLabel="Brak adresów"
      addActionLabel="Dodaj adres"
      emptyState={{ title: 'Brak adresów', actionLabel: 'Dodaj adres' }}
      dataAdapter={adapter}
      labelPrefix={prefix}
    />
  )
}

describe('localized shared addresses', () => {
  beforeEach(() => {
    jest.mocked(flash).mockClear()
    mockReportError.mockReset()
    mockTelemetryRuntime = { reportError: mockReportError }
  })

  it('shows dictionary labels on cards and preserves unknown type values', async () => {
    const list = jest.fn(async () => [{ value: 'office', label: 'Biuro' }])
    renderWithProviders(tiles({ list }, 'organization-1'))

    expect(await screen.findByText('Biuro')).toBeInTheDocument()
    expect(screen.queryByText('office')).not.toBeInTheDocument()
    expect(screen.getByText('legacy-type')).toBeInTheDocument()
    expect(list).toHaveBeenCalledWith('organization-1')
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('keeps addresses readable without a dictionary adapter', () => {
    renderWithProviders(tiles())
    expect(screen.getByText('office')).toBeInTheDocument()
  })

  it.each(['active', 'disabled', 'throwing'] as const)('keeps addresses readable and localizes a dictionary load failure with %s telemetry', async (telemetry) => {
    const error = new Error('[internal] dictionary unavailable')
    if (telemetry === 'disabled') mockTelemetryRuntime = undefined
    if (telemetry === 'throwing') {
      mockReportError.mockImplementation(() => { throw new Error('[internal] telemetry unavailable') })
    }
    renderWithProviders(tiles({ list: async () => { throw error } }))
    await waitFor(() => expect(flash).toHaveBeenCalledWith('Nie udało się wczytać typów adresów', 'error'))
    if (telemetry === 'disabled') {
      expect(mockReportError).not.toHaveBeenCalled()
    } else {
      expect(mockReportError).toHaveBeenCalledTimes(1)
      expect(mockReportError).toHaveBeenCalledWith(error, {
        module: 'ui',
        code: 'ui.address_types_load_failed',
      })
    }
    expect(screen.getByText('Biuro W47')).toBeInTheDocument()
    expect(screen.getByText('office')).toBeInTheDocument()
  })

  it('ignores a previous context lookup that finishes after the current lookup', async () => {
    let resolvePrevious: (options: AddressTypeOption[]) => void = () => undefined
    const previous = new Promise<AddressTypeOption[]>((resolve) => { resolvePrevious = resolve })
    const adapter: AddressTypesAdapter<string> = {
      list: async (context) => context === 'previous' ? previous : [{ value: 'office', label: 'Nowe biuro' }],
    }
    const view = renderWithProviders(tiles(adapter, 'previous'))
    view.rerender(tiles(adapter, 'current'))
    expect(await screen.findByText('Nowe biuro')).toBeInTheDocument()

    await act(async () => resolvePrevious([{ value: 'office', label: 'Poprzednie biuro' }]))
    expect(screen.getByText('Nowe biuro')).toBeInTheDocument()
    expect(screen.queryByText('Poprzednie biuro')).not.toBeInTheDocument()
  })

  it.each([
    ['customers.people.detail.addresses', customerPolish],
    ['staff.teamMembers.detail.addresses', staffPolish],
  ])('shows Polish loading copy for %s', (prefix, dictionary) => {
    const pending = new Promise<AddressSummary[]>(() => undefined)
    renderWithProviders(section(prefix, { ...emptyAdapter, list: () => pending }), { locale: 'pl', dict: dictionary })
    expect(screen.getByRole('status')).toHaveTextContent('Ładowanie adresów')
    expect(screen.queryByText('Loading addresses…')).not.toBeInTheDocument()
  })

  it.each([
    ['customers.people.detail.addresses', customerPolish, 'Format zgodny z ustawieniami adresów'],
    ['staff.teamMembers.detail.addresses', staffPolish, 'Format oparty na ustawieniach adresu'],
  ])('uses Polish format and cancel copy in the %s form', async (prefix, dictionary, hint) => {
    renderWithProviders(section(prefix), { locale: 'pl', dict: dictionary })
    fireEvent.click(await screen.findByRole('button', { name: 'Dodaj adres' }))
    expect(screen.getByText(hint)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anuluj' })).toBeInTheDocument()
    expect(screen.queryByText('Format based on address settings')).not.toBeInTheDocument()
  })
})
