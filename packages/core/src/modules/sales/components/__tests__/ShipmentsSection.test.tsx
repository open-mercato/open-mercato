/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, waitFor, act } from '@testing-library/react'

const mockApiCall = jest.fn()
const dialogProps: Array<Record<string, unknown>> = []

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: any[]) => mockApiCall(...args),
  apiCallOrThrow: (...args: any[]) => mockApiCall(...args),
  readApiResultOrThrow: (...args: any[]) => mockApiCall(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  deleteCrud: jest.fn().mockResolvedValue({ ok: true }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div data-testid="loading-message">{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
  TabEmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn().mockResolvedValue(true),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ organizationId: 'org', tenantId: 'tenant' }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (_key: string, fallback?: string) => fallback ?? _key
  return { useT: () => translate }
})

const mockEmit = jest.fn()
jest.mock('@open-mercato/core/modules/sales/lib/frontend/documentTotalsEvents', () => ({
  emitSalesDocumentTotalsRefresh: (...args: any[]) => mockEmit(...args),
  subscribeSalesDocumentTotalsRefresh: () => () => undefined,
}))

jest.mock('../documents/ShipmentDialog', () => ({
  __esModule: true,
  ShipmentDialog: (props: any) => {
    dialogProps.push(props)
    return props.open ? React.createElement('div', { 'data-testid': 'shipment-dialog-open' }) : null
  },
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SalesShipmentsSection } = require('../documents/ShipmentsSection')

describe('SalesShipmentsSection ghost popup regression (#1561)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    dialogProps.length = 0
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [] } })
  })

  it('closes the wizard synchronously before awaiting the shipments reload', async () => {
    const actionRef: { current: null | { onClick: () => void; label: string; disabled?: boolean } } = {
      current: null,
    }

    render(
      <SalesShipmentsSection
        orderId="order-1"
        currencyCode="USD"
        shippingAddressSnapshot={null}
        onActionChange={(next: any) => {
          actionRef.current = next
        }}
      />,
    )

    await waitFor(() => expect(actionRef.current).not.toBeNull(), { timeout: 4000 })
    await waitFor(() => expect(dialogProps.length).toBeGreaterThan(0), { timeout: 4000 })

    act(() => {
      actionRef.current!.onClick()
    })

    await waitFor(() => {
      const last = dialogProps[dialogProps.length - 1]
      expect(last?.open).toBe(true)
    }, { timeout: 4000 })

    const openedDialog = dialogProps[dialogProps.length - 1]
    expect(typeof openedDialog.onSaved).toBe('function')

    // Structural regression check (#1561).
    //
    // The bug: `onSaved` used to be
    //   async () => {
    //     await loadShipments()
    //     emit(...)
    //     setDialogState(null)   // only closed AFTER the 0.5–1s reload finished
    //   }
    // which left the wizard mounted during the reload. When the Section
    // re-rendered after `setLoading(false)`, the ShipmentDialog was still
    // `open`, and its own "Loading shipment…" placeholder flashed for 0.5–1s.
    //
    // The fix moves `setDialogState(null)` to run synchronously BEFORE the
    // reload, so by the time the reload completes, dialogState is already null.
    //
    // Because React 18 batches setState across microtask continuations in jsdom,
    // we can't observe the intermediate "open=true" render in this test. Instead
    // we verify the structural contract directly: in the `onSaved` function
    // source, the call that closes the dialog (`setDialogState(null)` /
    // `setDialogState(\n...null` — either form) must appear BEFORE the first
    // `await`. This is what prevents the ghost popup in a real browser.
    const saveFnSource = String(openedDialog.onSaved)
    const closeIdx = saveFnSource.search(/setDialogState\s*\(\s*null\s*\)/)
    const firstAwaitIdx = saveFnSource.search(/\bawait\b/)
    expect(closeIdx).toBeGreaterThanOrEqual(0)
    expect(firstAwaitIdx).toBeGreaterThanOrEqual(0)
    expect(closeIdx).toBeLessThan(firstAwaitIdx)

    // Behavioral check: the overall contract (reload + emit) is preserved.
    let releaseReload: () => void = () => undefined
    mockApiCall.mockImplementationOnce(
      () =>
        new Promise<{ ok: boolean; result: { items: unknown[] } }>((resolve) => {
          releaseReload = () => resolve({ ok: true, result: { items: [] } })
        }),
    )

    let savedPromise: Promise<void> | undefined
    act(() => {
      savedPromise = (openedDialog.onSaved as () => Promise<void>)()
    })

    await act(async () => {
      releaseReload()
      await savedPromise
    })

    expect(mockEmit).toHaveBeenCalledWith({ documentId: 'order-1', kind: 'order' })
    const lastRender = dialogProps[dialogProps.length - 1]
    expect(lastRender.open).toBe(false)
  }, 15000)
})
