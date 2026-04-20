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
        'sales.channel.create',
        'sales.channel.update',
        'sales.channel.delete',
        'sales.delivery-window.create',
        'sales.delivery-window.update',
        'sales.delivery-window.delete',
        'sales.shipping-method.create',
        'sales.shipping-method.update',
        'sales.shipping-method.delete',
        'sales.payment-method.create',
        'sales.payment-method.update',
        'sales.payment-method.delete',
        'sales.tax-rate.create',
        'sales.tax-rate.update',
        'sales.tax-rate.delete',
      ],
    },
    {
      label: '../documentAddresses',
      path: '../documentAddresses',
      expected: [
        'sales.settings.save',
        'sales.document-address.create',
        'sales.document-address.update',
        'sales.document-address.delete',
      ],
    },
    {
      label: '../documents (with dependencies)',
      path: '../documents',
      expected: [
        'sales.shipment.create',
        'sales.shipment.update',
        'sales.shipment.delete',
        'sales.payment.create',
        'sales.payment.update',
        'sales.payment.delete',
        'sales.settings.save',
        'sales.quote.update',
        'sales.quote.create',
        'sales.quote.delete',
        'sales.quote.convert_to_order',
        'sales.order.update',
        'sales.order.create',
        'sales.order.delete',
        'sales.order.line.upsert',
        'sales.order.line.delete',
        'sales.quote.line.upsert',
        'sales.quote.line.delete',
        'sales.order.adjustment.upsert',
        'sales.order.adjustment.delete',
        'sales.quote.adjustment.upsert',
        'sales.quote.adjustment.delete',
        'sales.invoice.create',
        'sales.invoice.update',
        'sales.invoice.delete',
        'sales.credit-memo.create',
        'sales.credit-memo.update',
        'sales.credit-memo.delete',
      ],
    },
    {
      label: '../notes',
      path: '../notes',
      expected: ['sales.note.create', 'sales.note.update', 'sales.note.delete'],
    },
    {
      label: '../payments',
      path: '../payments',
      expected: ['sales.payment.create', 'sales.payment.update', 'sales.payment.delete'],
    },
    {
      label: '../shipments',
      path: '../shipments',
      expected: ['sales.shipment.create', 'sales.shipment.update', 'sales.shipment.delete'],
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
      expected: ['sales.tag.create', 'sales.tag.update', 'sales.tag.delete'],
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
