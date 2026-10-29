/**
 * @jest-environment jsdom
 *
 * Regression test for issue #6309.
 *
 * The delta field re-derived its text from the committed number with `String()` on blur, so a
 * Polish user who typed `-2,5` saw `-2.5` the moment the field lost focus. The locale is pinned
 * to `pl-PL`: CI resolves `C.UTF-8` to an en-US ICU default, so an unpinned run would pass on
 * the buggy implementation too.
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { AdjustInventoryDialog } from '../AdjustInventoryDialog'

jest.mock('lucide-react', () => {
  const IconStub = () => null
  return new Proxy(
    { __esModule: true },
    { get: (target, prop) => (prop in target ? (target as Record<string | symbol, unknown>)[prop] : IconStub) },
  )
})

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
  useLocale: () => 'pl-PL',
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({ raiseCrudError: jest.fn() }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/inputs/ComboboxInput', () => ({
  ComboboxInput: () => null,
}))

jest.mock('../inventoryMutationLoaders', () => ({
  BalanceLookupError: class BalanceLookupError extends Error {},
  InventoryLotMutationError: class InventoryLotMutationError extends Error {},
  ensureLotIdForInventoryMutation: jest.fn(),
  fetchBalanceOnHand: jest.fn(async () => null),
  fetchVariantReorderPoint: jest.fn(async () => 0),
  findLotIdByNumber: jest.fn(async () => null),
  loadCatalogVariantOptions: jest.fn(async () => []),
  loadLocationOptions: jest.fn(async () => []),
  loadLotNumberOptions: jest.fn(async () => []),
  loadWarehouseOptions: jest.fn(async () => []),
  resolveCatalogVariantLabel: jest.fn(async () => null),
  resolveLocationLabel: jest.fn(async () => null),
  resolveLotNumberFromId: jest.fn(async () => null),
  resolveWarehouseLabel: jest.fn(async () => null),
}))

const access = {
  loading: false,
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  scopeReady: true,
  canAdjust: true,
  canReceive: true,
  canCycleCount: true,
  canImport: true,
  canMove: true,
  canRelease: true,
}

function findDeltaInput(): HTMLInputElement {
  const input = screen
    .getAllByRole('textbox')
    .find((element) => (element as HTMLInputElement).value === '1')
  if (!input) throw new Error('[internal] delta input not found')
  return input as HTMLInputElement
}

function typeSequentially(input: HTMLInputElement, text: string) {
  fireEvent.change(input, { target: { value: '' } })
  for (const char of text) {
    fireEvent.change(input, { target: { value: input.value + char } })
  }
}

describe('AdjustInventoryDialog delta field locale redisplay (issue #6309)', () => {
  it('keeps the decimal comma after the field loses focus', () => {
    render(<AdjustInventoryDialog open onOpenChange={jest.fn()} access={access as never} />)
    const input = findDeltaInput()
    fireEvent.focus(input)
    typeSequentially(input, '-2,5')
    expect(input.value).toBe('-2,5')
    fireEvent.blur(input)
    expect(input.value).toBe('-2,5')
  })

  it('normalizes a dot-typed delta to the locale comma on blur', () => {
    render(<AdjustInventoryDialog open onOpenChange={jest.fn()} access={access as never} />)
    const input = findDeltaInput()
    fireEvent.focus(input)
    typeSequentially(input, '2.5')
    fireEvent.blur(input)
    expect(input.value).toBe('2,5')
  })
})
