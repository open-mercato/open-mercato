/**
 * @jest-environment jsdom
 *
 * Regression test for issue #3529:
 * Opening the "Add Shipment" dialog used to trigger an infinite React re-render
 * loop ("Maximum update depth exceeded", originating from the bootstrap effect's
 * `setFormResetKey`) whenever `baseAddressOptions` received a fresh array
 * reference on every render. That happened when the parent passed a content-equal
 * but new-reference `shippingAddressSnapshot` object (exactly what happens after a
 * customer/address is added to the order), because the snapshot memos churned.
 *
 * The dialog must treat content-equal snapshots as referentially stable so the
 * on-open bootstrap effect (which bumps `formResetKey` and remounts the form) does
 * NOT re-fire on every render.
 */
import * as React from 'react'
import { act, render } from '@testing-library/react'
import { ShipmentDialog } from '../ShipmentDialog'

jest.setTimeout(20000)

let crudFormMountCount = 0

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: any[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: async (_headers: any, fn: any) => fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn().mockResolvedValue({ ok: true }),
  updateCrud: jest.fn().mockResolvedValue({ ok: true }),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldValues', () => ({
  collectCustomFieldValues: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  createCrudFormError: (message: string) => new Error(message),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('../optimisticLock', () => ({
  handleSectionMutationError: jest.fn(),
  rowOptimisticVersion: () => undefined,
}))

jest.mock('@open-mercato/core/modules/sales/lib/frontend/documentTotalsEvents', () => ({
  emitSalesDocumentTotalsRefresh: jest.fn(),
}))

jest.mock('@open-mercato/ui/hooks/useDialogKeyHandler', () => ({
  useDialogKeyHandler: () => () => {},
}))

jest.mock('lucide-react', () => ({
  MapPin: () => null,
  Truck: () => null,
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h3>{children}</h3>,
}))

jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: (props: any) => <input {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/textarea', () => ({
  Textarea: (props: any) => <textarea {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))

jest.mock('@open-mercato/ui/primitives/switch', () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={!!checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
}))

jest.mock('@open-mercato/ui/backend/inputs', () => ({
  LookupSelect: ({ value, onChange }: any) => (
    <select value={value ?? ''} onChange={(event) => onChange?.(event.target.value || null)}>
      <option value="">Select</option>
    </select>
  ),
}))

// CrudForm receives `key={formResetKey}` from ShipmentDialog, so every time the
// dialog bumps `formResetKey` (which happens inside the address-bootstrapping
// effect) this mock unmounts and remounts, incrementing the counter. A stable
// dialog must NOT remount the form when only the snapshot *reference* changes.
// The tripwire converts a re-introduced infinite loop into a fast, clear failure
// instead of an out-of-memory crash.
jest.mock('@open-mercato/ui/backend/CrudForm', () => {
  const ReactLib = require('react')
  return {
    CrudForm: ({ fields = [] }: any) => {
      ReactLib.useEffect(() => {
        crudFormMountCount += 1
        if (crudFormMountCount > 50) {
          throw new Error('[test] ShipmentDialog bootstrap effect re-render loop detected')
        }
      }, [])
      return (
        <form>
          {fields.map((field: any) => (
            <div key={field.id ?? field.name} data-testid={`crud-field-${field.id ?? field.name}`} />
          ))}
        </form>
      )
    },
  }
})

// Stable translator reference (mirrors the production I18nProvider, whose `t` is
// memoized on [locale, dict]) so the test isolates the snapshot-reference bug.
const translate = (key: string, fallback?: unknown) =>
  typeof fallback === 'string' ? fallback : key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => translate,
}))

const baseLines = [
  { id: 'line-1', title: 'Product A', lineNumber: 1, quantity: 2, thumbnail: null },
]

const computeAvailable = () => 5
const noop = () => {}
const noopAsync = async () => {}

// Content-equal snapshot, but a brand-new object reference on every call —
// simulating an unmemoized prop handed down by the order detail page.
const makeSnapshot = () => ({
  addressLine1: '1 Main Street',
  city: 'Townsville',
  postalCode: '12345',
  country: 'US',
})

const renderDialog = () => (
  <ShipmentDialog
    open
    mode="create"
    shipment={null}
    lines={baseLines}
    orderId="order-1"
    currencyCode="USD"
    organizationId="org-1"
    tenantId="tenant-1"
    computeAvailable={computeAvailable}
    shippingAddressSnapshot={makeSnapshot()}
    onClose={noop}
    onSaved={noopAsync}
  />
)

describe('ShipmentDialog re-render stability (issue #3529)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    crudFormMountCount = 0
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [] } })
  })

  it('does not remount the form when the snapshot reference changes but content does not', async () => {
    const { rerender } = render(renderDialog())

    // Let the on-open async loaders (shipping methods, addresses, statuses) settle.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const baselineMounts = crudFormMountCount

    // Simulate the parent re-rendering repeatedly, each time handing the dialog a
    // brand-new snapshot object that is content-equal to the previous one.
    for (let pass = 0; pass < 4; pass += 1) {
      rerender(renderDialog())
      await act(async () => {
        await Promise.resolve()
      })
    }

    // Before the fix, each content-equal rerender re-ran the bootstrap effect and
    // bumped `formResetKey`, remounting the form once per pass. With stable
    // `baseAddressOptions`, none of those rerenders should remount the form.
    expect(crudFormMountCount).toBe(baselineMounts)
  })
})
