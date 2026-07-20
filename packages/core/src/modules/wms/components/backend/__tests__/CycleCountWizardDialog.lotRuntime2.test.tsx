/**
 * @jest-environment jsdom
 *
 * Reproduces the cycle-count "scope queue" scenario: after posting one line,
 * the wizard advances to the next queued location/variant/lot via
 * resetToStep2(), which prefills form.lotId with a real UUID BEFORE the
 * label-resolution effect has had a chance to resolve it to a human label.
 * If the user focuses the Lot field before that label resolves, does the
 * suggestions loader ever leave the loading state?
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CycleCountWizardDialog } from '../CycleCountWizardDialog'

jest.setTimeout(20000)

const UUID_WAREHOUSE = '11111111-1111-4111-8111-111111111111'
const UUID_ZONE = '22222222-2222-4222-8222-222222222222'
const UUID_USER = '99999999-9999-4999-8999-999999999999'
const UUID_VARIANT_1 = '33333333-3333-4333-8333-333333333333'
const UUID_LOCATION = '55555555-5555-4555-8555-555555555555'
const UUID_LOT = '66666666-6666-4666-8666-666666666666'

const mockT = (_key: string, fallback: string) => fallback ?? _key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockT,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('../../../lib/flashMutationError', () => ({
  flashMutationError: jest.fn(),
}))

// Let resolveLotLabel resolution be controllable so the test can pick the
// exact moment (before/after) the human label becomes known relative to the
// user's focus event.
let resolveLotLabelGate: Promise<void> = Promise.resolve()

const mockApiCall = jest.fn(async (input: unknown) => {
  const url = String(input)
  const [path, queryString] = url.split('?')
  const params = new URLSearchParams(queryString ?? '')

  if (path === '/api/wms/inventory/balances') {
    if (params.get('locationId') === UUID_LOCATION && params.get('catalogVariantId') === UUID_VARIANT_1) {
      return {
        ok: true,
        result: {
          items: [{ lot_id: UUID_LOT, quantity_on_hand: 5, quantity_available: 5 }],
          total: 1,
          totalPages: 1,
        },
      }
    }
    return { ok: true, result: { items: [], total: 0, totalPages: 0 } }
  }
  if (path === '/api/wms/lots') {
    if (params.get('id') === UUID_LOT) {
      // This is the resolveLotLabel(id) call the dialog's ensureLabel effect
      // makes; gate it so the test controls exactly when it resolves.
      await resolveLotLabelGate
    }
    return {
      ok: true,
      result: { items: [{ id: UUID_LOT, lot_number: 'LOT-100' }], total: 1, totalPages: 1 },
    }
  }
  if (path === '/api/catalog/variants') {
    return {
      ok: true,
      result: { items: [{ id: UUID_VARIANT_1, sku: 'SKU-1', name: 'Widget' }], total: 1, totalPages: 1 },
    }
  }
  if (path === '/api/wms/locations') {
    return {
      ok: true,
      result: { items: [{ id: UUID_LOCATION, code: 'BIN-01', type: 'bin' }], total: 1, totalPages: 1 },
    }
  }
  return { ok: true, result: { items: [], total: 0, totalPages: 0 } }
})

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

const mockRunMutation = jest.fn()
const mockRetryLastMutation = jest.fn()

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: mockRunMutation,
    retryLastMutation: mockRetryLastMutation,
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  raiseCrudError: jest.fn(),
  readJsonSafe: jest.fn(async () => null),
}))

jest.mock('@open-mercato/ui/backend/inputs/DateTimePicker', () => ({
  DateTimePicker: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: Date | null
    onChange: (next: Date | null) => void
    placeholder?: string
  }) => (
    <input
      placeholder={placeholder}
      value={value ? value.toISOString() : ''}
      onChange={(e) => onChange(e.target.value ? new Date(e.target.value) : null)}
    />
  ),
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children, onKeyDown }: { children: React.ReactNode; onKeyDown?: (event: React.KeyboardEvent) => void }) => (
    <div onKeyDown={onKeyDown}>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))

const REAL_PLACEHOLDERS = new Set([
  'Search variant or SKU',
  'Select location',
  'Select lot (optional)',
])

jest.mock('@open-mercato/ui/backend/inputs/ComboboxInput', () => {
  const RealModule = jest.requireActual('@open-mercato/ui/backend/inputs/ComboboxInput')
  return {
    ComboboxInput: (props: Record<string, unknown> & { placeholder?: string; value: string; onChange: (v: string) => void; disabled?: boolean }) => {
      if (REAL_PLACEHOLDERS.has(props.placeholder ?? '')) {
        return <RealModule.ComboboxInput {...props} />
      }
      return (
        <input
          placeholder={props.placeholder}
          value={props.value}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )
    },
  }
})

const buildAccess = (overrides: Record<string, unknown> = {}) => ({
  loading: false,
  organizationId: 'org-uuid-1',
  tenantId: 'tenant-uuid-1',
  userId: UUID_USER,
  scopeReady: true,
  canAdjust: true,
  canReceive: true,
  canReserve: true,
  canCycleCount: true,
  canImport: true,
  canMove: true,
  canRelease: true,
  ...overrides,
})

async function wait(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function selectRealCombobox(placeholder: string, optionLabel: string) {
  const input = await screen.findByPlaceholderText(placeholder)
  await act(async () => {
    fireEvent.focus(input)
  })
  const option = await screen.findByText(optionLabel, undefined, { timeout: 5000 })
  await act(async () => {
    fireEvent.click(option)
  })
}

describe('CycleCountWizardDialog — Lot field with a prefilled (unresolved) lotId', () => {
  beforeEach(() => {
    mockApiCall.mockClear()
    resolveLotLabelGate = new Promise(() => {}) // never resolves until swapped below
  })

  it('resolves out of loading when the user focuses the Lot field before its label resolves', async () => {
    render(<CycleCountWizardDialog open onOpenChange={jest.fn()} access={buildAccess()} />)

    fireEvent.change(screen.getByPlaceholderText('Select warehouse'), {
      target: { value: UUID_WAREHOUSE },
    })
    fireEvent.change(await screen.findByPlaceholderText('Select zone'), {
      target: { value: UUID_ZONE },
    })
    await waitFor(() => expect(screen.getByDisplayValue('1')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Start counting' }))
    await screen.findByPlaceholderText('Select lot (optional)')

    await selectRealCombobox('Search variant or SKU', 'SKU-1')
    await selectRealCombobox('Select location', 'BIN-01')

    await waitFor(() =>
      expect((screen.getByPlaceholderText('Select lot (optional)') as HTMLInputElement).disabled).toBe(false),
    )

    // Now select the lot itself once (to populate form.lotId with a real
    // UUID and simulate a queued item that already had a lot), WITHOUT
    // letting resolveLotLabel settle yet.
    const lotInput = screen.getByPlaceholderText('Select lot (optional)') as HTMLInputElement
    await act(async () => {
      fireEvent.focus(lotInput)
    })
    await wait(400)
    const lotOption = await screen.findByText('LOT-100')
    await act(async () => {
      fireEvent.click(lotOption)
    })

    // Blur, so the field is "unfocused" the way it would be after a
    // selection, then immediately re-focus it — mirroring a user reopening
    // the field to double check their selection — all while resolveLotLabel
    // (gated above) has NOT resolved yet, so optionLabelByValue[lotId] is
    // still unknown and the visible input text may still be the raw UUID.
    await act(async () => {
      fireEvent.blur(lotInput)
    })
    await wait(50)
    await act(async () => {
      fireEvent.focus(lotInput)
    })

    await wait(400)

    const stillLoading = screen.queryByText(/Loading suggestions/i)
    // eslint-disable-next-line no-console
    console.log('[diagnostic] stillLoading after re-focus with unresolved label:', Boolean(stillLoading))
    // eslint-disable-next-line no-console
    console.log('[diagnostic] lot input value:', lotInput.value)

    // Now let resolveLotLabel resolve and see if that unsticks anything.
    resolveLotLabelGate = Promise.resolve()
    await wait(400)

    const stillLoadingAfterLabelResolves = screen.queryByText(/Loading suggestions/i)
    // eslint-disable-next-line no-console
    console.log('[diagnostic] stillLoading after label resolves:', Boolean(stillLoadingAfterLabelResolves))
    console.log('[diagnostic] lot input value after label resolves:', lotInput.value)
  })
})
