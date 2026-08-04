/**
 * @jest-environment jsdom
 *
 * Runtime reproduction for the reported "stuck on 'Loading suggestions…'"
 * bug in the cycle count Lot field. Unlike CycleCountWizardDialog.test.tsx
 * (which mocks ComboboxInput entirely and only asserts loadSuggestions
 * referential stability), this suite mounts the REAL ComboboxInput for the
 * Variant/Location/Lot fields and drives real focus/debounce/click
 * interactions against a mocked apiCall, so it actually exercises
 * ComboboxInput's internal loading state machine end to end.
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

// Delay applied to every `/api/wms/inventory/balances` response, so tests can
// simulate the real network latency that widens the disable/re-enable race
// on the Lot field (jsdom + an instantly-resolving mock never reproduced the
// original bug report — see the "does not get stuck" test below).
let balancesLookupDelayMs = 0

const mockApiCall = jest.fn(async (input: unknown) => {
  const url = String(input)
  const [path, queryString] = url.split('?')
  const params = new URLSearchParams(queryString ?? '')

  if (path === '/api/wms/inventory/balances') {
    if (balancesLookupDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, balancesLookupDelayMs))
    }
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

// Warehouse/Zone/Assignee/From-bin/To-bin are irrelevant to the Lot-field bug
// under test — keep them as plain inputs (matching the existing suite) so the
// setup steps stay fast and deterministic. Variant/Location/Lot are the REAL
// ComboboxInput so this suite exercises the actual debounce/loading state
// machine the bug report is about.
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

async function advanceToCountingStepWithScope() {
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
    expect(
      (screen.getByPlaceholderText('Select lot (optional)') as HTMLInputElement).disabled,
    ).toBe(false),
  )
  // Let the balance-on-hand effect settle so loadingBalance stops flapping the
  // Lot field's `disabled` prop before we start interacting with it.
  await waitFor(() =>
    expect(
      (screen.getByPlaceholderText(
        'Optional — defects, packaging notes',
      ) as HTMLTextAreaElement).disabled,
    ).toBe(false),
  )
  await wait(50)
}

describe('CycleCountWizardDialog — Lot field runtime behavior (real ComboboxInput)', () => {
  beforeEach(() => {
    mockApiCall.mockClear()
    balancesLookupDelayMs = 0
  })

  it('resolves out of the loading state and renders the matching lot suggestion', async () => {
    await advanceToCountingStepWithScope()

    const lotInput = screen.getByPlaceholderText('Select lot (optional)')
    await act(async () => {
      fireEvent.focus(lotInput)
    })

    // Debounce is 200ms; give it real time plus microtask flushes for the
    // apiCall chain (balances -> lots) to resolve.
    await wait(400)

    expect(screen.queryByText(/Loading suggestions/i)).toBeNull()
    await waitFor(() => expect(screen.getByText('LOT-100')).toBeTruthy())
  })

  it('still resolves when an unrelated field re-renders the wizard while the Lot suggestions are in flight', async () => {
    await advanceToCountingStepWithScope()

    const lotInput = screen.getByPlaceholderText('Select lot (optional)')
    await act(async () => {
      fireEvent.focus(lotInput)
    })

    const notes = screen.getByPlaceholderText('Optional — defects, packaging notes')
    // Fire several unrelated re-renders of the whole wizard while the Lot
    // suggestions request is still pending (within the 200ms debounce
    // window), mirroring label-resolution/balance-refresh churn that happens
    // in production while a user is interacting with the form.
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        fireEvent.change(notes, { target: { value: `note ${i}` } })
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
    }

    await wait(400)

    expect(screen.queryByText(/Loading suggestions/i)).toBeNull()
    await waitFor(() => expect(screen.getByText('LOT-100')).toBeTruthy())
  })

  // End-to-end confidence check for the reported flow: picking a lot changes
  // `form.lotId`, which is itself a dependency of the system-on-hand balance
  // effect, so selecting a lot immediately re-triggers `loadingBalance` —
  // which disables the very Lot field the user just used (its `disabled`
  // prop includes `loadingBalance`). This exercises that disable/re-enable
  // cycle under realistic network latency end to end; the primitive-level
  // race this guards against (a disabled toggle cancelling an in-flight
  // suggestion fetch) is precisely reproduced and asserted in
  // `packages/ui/.../ComboboxInput.test.tsx` ("does not cancel/restart…").
  it('does not get stuck loading after selecting a lot re-triggers the balance lookup', async () => {
    balancesLookupDelayMs = 120
    await advanceToCountingStepWithScope()

    await selectRealCombobox('Select lot (optional)', 'LOT-100')

    // The lot pick just re-triggered a fresh (delayed) balance lookup, which
    // disables the Lot field for its duration. Once it resolves and the
    // field re-enables, focusing it again must not show a stuck spinner.
    await waitFor(() =>
      expect(
        (screen.getByPlaceholderText('Select lot (optional)') as HTMLInputElement).disabled,
      ).toBe(false),
    )

    const lotInput = screen.getByPlaceholderText('Select lot (optional)') as HTMLInputElement
    expect(lotInput.value).toBe('LOT-100')

    await act(async () => {
      fireEvent.focus(lotInput)
    })
    await wait(400)

    expect(screen.queryByText(/Loading suggestions/i)).toBeNull()
    await waitFor(() => expect(screen.getByText('LOT-100')).toBeTruthy())
  })
})
