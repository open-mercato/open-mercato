/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CycleCountWizardDialog } from '../CycleCountWizardDialog'

const UUID_WAREHOUSE = '11111111-1111-4111-8111-111111111111'
const UUID_ZONE = '22222222-2222-4222-8222-222222222222'
const UUID_USER = '99999999-9999-4999-8999-999999999999'
const UUID_VARIANT_1 = '33333333-3333-4333-8333-333333333333'
const UUID_VARIANT_2 = '44444444-4444-4444-8444-444444444444'
const UUID_LOCATION = '55555555-5555-4555-8555-555555555555'

// `t` must stay referentially stable across renders (as the real `useT`
// context value is) — a fresh arrow function on every call previously caused
// effects keyed on `t` to re-fire every render, masking the actual bug this
// suite targets behind an unrelated infinite-loop test artifact.
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

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
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

// DateTimePicker's underlying Radix Popover/FocusScope stack doesn't settle
// in jsdom outside a real browser paint loop; stub it with a plain input so
// the wizard renders deterministically for this suite.
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

// Radix Dialog's FocusScope container-ref callback doesn't settle in jsdom
// for a wizard this deep (unrelated to the bug under test); render plain
// markup instead so the suite focuses on the wizard's own state/callback
// wiring rather than Radix's focus-trap behavior.
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

type CapturedComboboxProps = {
  loadSuggestions?: (query?: string) => Promise<unknown>
  resolveLabel?: (value: string) => unknown
}

// Keyed by placeholder so tests can assert that the `loadSuggestions` callback
// a given combobox receives stays referentially stable across re-renders that
// shouldn't affect it — regression coverage for the Lot combobox getting stuck
// on "Loading suggestions…" because its loader was an inline arrow function
// recreated on every render, tearing down ComboboxInput's debounced fetch
// before it could resolve.
const mockComboboxCaptures: Record<string, CapturedComboboxProps> = {}

jest.mock('@open-mercato/ui/backend/inputs/ComboboxInput', () => ({
  ComboboxInput: ({
    placeholder,
    value,
    onChange,
    loadSuggestions,
    resolveLabel,
  }: {
    placeholder: string
    value: string
    onChange: (v: string) => void
  } & CapturedComboboxProps) => {
    mockComboboxCaptures[placeholder] = { loadSuggestions, resolveLabel }
    return (
      <input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`combobox-${placeholder}`}
      />
    )
  },
}))

jest.mock('../inventoryMutationLoaders', () => {
  const actual = jest.requireActual('../inventoryMutationLoaders')
  return {
    ...actual,
    loadWarehouseOptions: jest.fn(async () => []),
    loadZoneOptions: jest.fn(async () => []),
    loadBinLocationOptions: jest.fn(async () => []),
    loadLocationOptions: jest.fn(async () => []),
    loadAllLocations: jest.fn(async () => []),
    loadAssigneeOptions: jest.fn(async () => ({ options: [], canListUsers: true })),
    loadCatalogVariantOptions: jest.fn(async () => []),
    loadLotOptionsForBalanceLocation: jest.fn(async () => []),
    resolveWarehouseLabel: jest.fn(async () => null),
    resolveZoneLabel: jest.fn(async () => null),
    resolveLocationLabel: jest.fn(async () => null),
    resolveCatalogVariantLabel: jest.fn(async () => null),
    resolveLotLabel: jest.fn(async () => null),
    resolveAssigneeLabel: jest.fn(async () => null),
    fetchCycleCountScopeEstimate: jest.fn(async () => ({ expectedSkus: 1, binCount: 1 })),
    fetchBalanceOnHand: jest.fn(async () => 0),
    buildCycleCountScopeQueue: jest.fn(async () => []),
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

async function advanceToCountingStep() {
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

  fireEvent.change(screen.getByPlaceholderText('Search variant or SKU'), {
    target: { value: UUID_VARIANT_1 },
  })
  fireEvent.change(screen.getByPlaceholderText('Select location'), {
    target: { value: UUID_LOCATION },
  })

  await waitFor(() =>
    expect(
      (screen.getByPlaceholderText('Select lot (optional)') as HTMLInputElement).disabled,
    ).toBe(false),
  )

  // Let the balance-on-hand effect's async fetch settle too, so it doesn't
  // update state after the test body returns (act() warning noise only).
  await waitFor(() =>
    expect(
      (screen.getByPlaceholderText(
        'Optional — defects, packaging notes',
      ) as HTMLTextAreaElement).disabled,
    ).toBe(false),
  )
  await act(async () => {
    await Promise.resolve()
  })
}

describe('CycleCountWizardDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    for (const key of Object.keys(mockComboboxCaptures)) delete mockComboboxCaptures[key]
  })

  it('reaches the counting step with variant and location scoped', async () => {
    await advanceToCountingStep()
    expect(screen.getByPlaceholderText('Select lot (optional)')).toBeTruthy()
  })

  // Regression coverage: an inline `loadSuggestions` arrow function passed to
  // the Lot ComboboxInput was recreated on every render of the wizard, so any
  // unrelated re-render (balance refresh, label resolution, etc.) tore down
  // and rescheduled ComboboxInput's debounced fetch effect before it could
  // resolve — leaving the "Loading suggestions…" state stuck forever.
  it('keeps the Lot loadSuggestions callback stable across an unrelated re-render', async () => {
    await advanceToCountingStep()

    const before = mockComboboxCaptures['Select lot (optional)']
    expect(before.loadSuggestions).toBeInstanceOf(Function)

    // Unrelated state update: typing into the counting-step notes field.
    fireEvent.change(
      screen.getByPlaceholderText('Optional — defects, packaging notes'),
      { target: { value: 'unrelated note' } },
    )

    const after = mockComboboxCaptures['Select lot (optional)']
    expect(after.loadSuggestions).toBe(before.loadSuggestions)
  })

  it('refreshes the Lot loadSuggestions callback once the scoped variant or location changes', async () => {
    await advanceToCountingStep()

    const beforeLot = mockComboboxCaptures['Select lot (optional)']
    expect(beforeLot.loadSuggestions).toBeInstanceOf(Function)

    fireEvent.change(screen.getByPlaceholderText('Search variant or SKU'), {
      target: { value: UUID_VARIANT_2 },
    })

    const afterVariantChange = mockComboboxCaptures['Select lot (optional)']
    expect(afterVariantChange.loadSuggestions).not.toBe(beforeLot.loadSuggestions)
  })
})
