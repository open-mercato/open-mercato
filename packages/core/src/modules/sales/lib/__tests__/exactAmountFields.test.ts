import { withExactAmounts, withExactListAmounts } from '@open-mercato/shared/lib/decimal'
import {
  creditMemoCreateSchema,
  invoiceCreateSchema,
  invoiceUpdateSchema,
  orderCreateSchema,
  paymentCreateSchema,
  shippingMethodCreateSchema,
  shippingMethodUpdateSchema,
} from '../../data/validators'
import {
  DOCUMENT_TOTAL_EXACT_AMOUNT_FIELDS,
  LINE_EXACT_AMOUNT_FIELDS,
  PAYMENT_EXACT_AMOUNT_FIELDS,
  SHIPPING_METHOD_EXACT_AMOUNT_FIELDS,
  withExactDocumentInput,
  withExactInvoiceInput,
  withExactPaymentInput,
  withExactShippingMethodInput,
} from '../exactAmountFields'

const scope = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
}

const precise = '1.123456789012345678'
const wei = '0.000000000000000001'
const longAmount = '1234567890.123456789012345'

describe('exact amount route helpers', () => {
  it('keeps document rate and line digits from the route parse through the command parse', () => {
    const body = {
      ...scope,
      currencyCode: 'ETH',
      exchangeRate: '0.000056123456789012345',
      lines: [{ currencyCode: 'ETH', quantity: 3, unitPriceNet: wei, unitPriceGross: wei }],
    }
    const routeInput = withExactDocumentInput(orderCreateSchema.parse(body), body)
    const commandInput = withExactAmounts(orderCreateSchema.parse(routeInput), routeInput, ['exchangeRate'] as const)
    const commandLines = withExactListAmounts(commandInput.lines, routeInput, 'lines', LINE_EXACT_AMOUNT_FIELDS)

    expect(commandInput.exchangeRateExact).toBe('0.000056123456789012345')
    expect(commandLines?.[0]?.unitPriceNetExact).toBe(wei)
    expect(commandLines?.[0]?.unitPriceGrossExact).toBe(wei)
  })

  it('keeps payment and allocation digits from the route parse through the command parse', () => {
    const body = {
      ...scope,
      currencyCode: 'ETH',
      amount: precise,
      allocations: [{ currencyCode: 'ETH', amount: precise }],
    }
    const routeInput = withExactPaymentInput(paymentCreateSchema.parse(body), body)
    const commandInput = withExactAmounts(paymentCreateSchema.parse(routeInput), routeInput, PAYMENT_EXACT_AMOUNT_FIELDS)
    const commandAllocations = withExactListAmounts(commandInput.allocations, routeInput, 'allocations', ['amount'] as const)

    expect(commandInput.amountExact).toBe(precise)
    expect(commandAllocations?.[0]?.amountExact).toBe(precise)
  })

  it('keeps invoice totals and line digits from the route parse through the command parse', () => {
    const body = {
      ...scope,
      currencyCode: 'EUR',
      grandTotalGrossAmount: longAmount,
      outstandingAmount: longAmount,
      lines: [{ currencyCode: 'EUR', quantity: 1, unitPriceNet: longAmount, totalGrossAmount: longAmount }],
    }
    const routeInput = withExactInvoiceInput(invoiceCreateSchema.parse(body), body)
    const commandInput = withExactAmounts(
      invoiceCreateSchema.parse(routeInput),
      routeInput,
      DOCUMENT_TOTAL_EXACT_AMOUNT_FIELDS,
    )
    const commandLines = withExactListAmounts(commandInput.lines, routeInput, 'lines', LINE_EXACT_AMOUNT_FIELDS)

    expect(commandInput.grandTotalGrossAmountExact).toBe(longAmount)
    expect(commandInput.outstandingAmountExact).toBe(longAmount)
    expect(commandLines?.[0]?.unitPriceNetExact).toBe(longAmount)
    expect(commandLines?.[0]?.totalGrossAmountExact).toBe(longAmount)
  })

  it('keeps invoice update header digits from the route parse', () => {
    const body = { ...scope, id: '00000000-0000-4000-8000-000000000003', subtotalNetAmount: longAmount }
    const routeInput = withExactInvoiceInput(invoiceUpdateSchema.parse(body), body)

    expect(routeInput).toHaveProperty('subtotalNetAmountExact', longAmount)
  })

  it('keeps credit memo totals and line digits from the route parse through the command parse', () => {
    const body = {
      ...scope,
      currencyCode: 'EUR',
      grandTotalNetAmount: longAmount,
      lines: [{ currencyCode: 'EUR', quantity: 1, unitPriceGross: longAmount }],
    }
    const routeInput = withExactInvoiceInput(creditMemoCreateSchema.parse(body), body)
    const commandInput = withExactAmounts(
      creditMemoCreateSchema.parse(routeInput),
      routeInput,
      DOCUMENT_TOTAL_EXACT_AMOUNT_FIELDS,
    )
    const commandLines = withExactListAmounts(commandInput.lines, routeInput, 'lines', LINE_EXACT_AMOUNT_FIELDS)

    expect(commandInput.grandTotalNetAmountExact).toBe(longAmount)
    expect(commandLines?.[0]?.unitPriceGrossExact).toBe(longAmount)
  })

  it('keeps shipping method base rate digits from the route parse through the command parse', () => {
    const body = { ...scope, name: 'Courier', code: 'courier', baseRateNet: longAmount, baseRateGross: longAmount }
    const routeInput = withExactShippingMethodInput(shippingMethodCreateSchema.parse(body), body)
    const commandInput = withExactAmounts(
      shippingMethodCreateSchema.parse(routeInput),
      routeInput,
      SHIPPING_METHOD_EXACT_AMOUNT_FIELDS,
    )

    expect(commandInput.baseRateNetExact).toBe(longAmount)
    expect(commandInput.baseRateGrossExact).toBe(longAmount)
  })

  it('only attaches shipping method exact strings for the base rates that were sent', () => {
    const body = { ...scope, id: '00000000-0000-4000-8000-000000000004', baseRateGross: longAmount }
    const routeInput = withExactShippingMethodInput(shippingMethodUpdateSchema.parse(body), body)

    expect(routeInput).toHaveProperty('baseRateGrossExact', longAmount)
    expect(routeInput).not.toHaveProperty('baseRateNetExact')
  })
})
