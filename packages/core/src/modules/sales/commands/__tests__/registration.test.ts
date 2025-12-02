/** @jest-environment node */

export {}

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('sales command registration', () => {
  const cases = [
    {
      label: '../configuration',
      path: '../configuration',
      expected: [
        'sales.channels.create',
        'sales.channels.update',
        'sales.channels.delete',
        'sales.delivery-windows.create',
        'sales.delivery-windows.update',
        'sales.delivery-windows.delete',
        'sales.shipping-methods.create',
        'sales.shipping-methods.update',
        'sales.shipping-methods.delete',
        'sales.payment-methods.create',
        'sales.payment-methods.update',
        'sales.payment-methods.delete',
        'sales.tax-rates.create',
        'sales.tax-rates.update',
        'sales.tax-rates.delete',
      ],
    },
    {
      label: '../documentAddresses',
      path: '../documentAddresses',
      expected: [
        'sales.settings.save',
        'sales.document-addresses.create',
        'sales.document-addresses.update',
        'sales.document-addresses.delete',
      ],
    },
    {
      label: '../documents (with dependencies)',
      path: '../documents',
      expected: [
        'sales.shipments.create',
        'sales.shipments.update',
        'sales.shipments.delete',
        'sales.payments.create',
        'sales.payments.update',
        'sales.payments.delete',
        'sales.settings.save',
        'sales.quotes.update',
        'sales.quotes.create',
        'sales.quotes.delete',
        'sales.orders.update',
        'sales.orders.create',
        'sales.orders.delete',
        'sales.orders.lines.upsert',
        'sales.orders.lines.delete',
        'sales.quotes.lines.upsert',
        'sales.quotes.lines.delete',
        'sales.orders.adjustments.upsert',
        'sales.orders.adjustments.delete',
        'sales.quotes.adjustments.upsert',
        'sales.quotes.adjustments.delete',
      ],
    },
    {
      label: '../notes',
      path: '../notes',
      expected: ['sales.notes.create', 'sales.notes.update', 'sales.notes.delete'],
    },
    {
      label: '../payments',
      path: '../payments',
      expected: ['sales.payments.create', 'sales.payments.update', 'sales.payments.delete'],
    },
    {
      label: '../shipments',
      path: '../shipments',
      expected: ['sales.shipments.create', 'sales.shipments.update', 'sales.shipments.delete'],
    },
    {
      label: '../statuses',
      path: '../statuses',
      expected: [
        'sales.order-statuses.create',
        'sales.order-statuses.update',
        'sales.order-statuses.delete',
        'sales.order-line-statuses.create',
        'sales.order-line-statuses.update',
        'sales.order-line-statuses.delete',
        'sales.shipment-statuses.create',
        'sales.shipment-statuses.update',
        'sales.shipment-statuses.delete',
        'sales.payment-statuses.create',
        'sales.payment-statuses.update',
        'sales.payment-statuses.delete',
        'sales.adjustment-kinds.create',
        'sales.adjustment-kinds.update',
        'sales.adjustment-kinds.delete',
      ],
    },
    {
      label: '../settings',
      path: '../settings',
      expected: ['sales.settings.save'],
    },
    {
      label: '../tags',
      path: '../tags',
      expected: ['sales.tags.create', 'sales.tags.update', 'sales.tags.delete'],
    },
  ]

  beforeEach(() => {
    registerCommand.mockClear()
    jest.resetModules()
  })

  for (const testCase of cases) {
    it(`registers commands for ${testCase.label}`, () => {
      jest.isolateModules(() => {
        require(testCase.path)
      })

      const ids = registerCommand.mock.calls.map(([cmd]) => cmd.id)
      expect(ids).toEqual(testCase.expected)
    })
  }
})
