/**
 * @jest-environment jsdom
 *
 * Regression test for review finding F3 on PR #7324.
 *
 * The API stores each price-list row as a float `amount` plus an exact `amountExact` sibling.
 * The form used to hydrate rows from the float alone, so an 18-decimal ETH price of
 * `1.123456789012345678` came back as `1.1234567890123457` and a save that only touched the
 * title silently rewrote the stored price. Rows now hydrate from `amountExact` (formatted for the
 * locale, like the scalar fixed/custom amounts) and submit the exact decimal string.
 */
import * as React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'

const mockLocale = { current: 'en-US' }
const capturedCrudFormProps: { current: Record<string, unknown> | null } = { current: null }
const mockReadApiResultOrThrow = jest.fn()

jest.mock('lucide-react', () => {
  const IconStub = () => null
  return new Proxy(
    { __esModule: true },
    { get: (target, prop) => (prop in target ? (target as Record<string | symbol, unknown>)[prop] : IconStub) },
  )
})

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  RecordNotFoundState: () => null,
}))

const mockTranslate = (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key)

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
  useLocale: () => mockLocale.current,
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => {
    capturedCrudFormProps.current = props
    return null
  },
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, status: 200, result: null })),
  apiCallOrThrow: jest.fn(async () => ({ ok: true, status: 200, result: null })),
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
  withScopedApiRequestHeaders: async (_headers: unknown, run: () => Promise<unknown>) => run(),
}))

jest.mock('../CheckoutCurrencySelect', () => ({
  CheckoutCurrencySelect: () => null,
}))

jest.mock('../CustomerFieldsEditor', () => ({
  CustomerFieldsEditor: () => null,
}))

jest.mock('../GatewaySettingsFields', () => ({
  GatewaySettingsFields: () => null,
}))

jest.mock('../LogoUploadField', () => ({
  LogoUploadField: () => null,
}))

import { LinkTemplateForm, normalizeFormValues, PriceListEditor } from '../LinkTemplateForm'

const RECORD_ID = 'record-1'
const EXACT_AMOUNT = '1.123456789012345678'
const FLOAT_AMOUNT = 1.1234567890123457

function persistedRecord() {
  return {
    id: RECORD_ID,
    name: 'ETH checkout',
    title: 'Original title',
    slug: 'eth-checkout',
    pricingMode: 'price_list',
    updatedAt: '2026-11-01T10:00:00.000Z',
    priceListItems: [
      { id: 'eth', description: 'ETH', amount: FLOAT_AMOUNT, amountExact: EXACT_AMOUNT, currencyCode: 'ETH' },
    ],
  }
}

type SubmitHandler = (values: Record<string, unknown>, context?: unknown) => Promise<void>

async function renderPersistedForm(mode: 'link' | 'template') {
  capturedCrudFormProps.current = null
  mockReadApiResultOrThrow.mockReset()
  mockReadApiResultOrThrow.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'PUT') return { ok: true }
    if (url.startsWith('/api/payment_gateways/providers')) return { items: [] }
    if (url.startsWith(`/api/checkout/${mode === 'link' ? 'links' : 'templates'}/${RECORD_ID}`)) return persistedRecord()
    return { items: [] }
  })
  render(<LinkTemplateForm mode={mode} recordId={RECORD_ID} />)
  await waitFor(() => {
    const initialValues = capturedCrudFormProps.current?.initialValues as Record<string, unknown> | undefined
    expect(initialValues?.title).toBe('Original title')
  })
  const props = capturedCrudFormProps.current as Record<string, unknown>
  return {
    initialValues: props.initialValues as Record<string, unknown>,
    onSubmit: props.onSubmit as SubmitHandler,
  }
}

function readSubmittedBody(): Record<string, unknown> {
  const putCall = mockReadApiResultOrThrow.mock.calls.find(([, init]) => init?.method === 'PUT')
  expect(putCall).toBeDefined()
  return JSON.parse(String(putCall?.[1]?.body)) as Record<string, unknown>
}

describe('LinkTemplateForm price list exact amounts (PR #7324 finding F3)', () => {
  afterEach(() => {
    mockLocale.current = 'en-US'
  })

  describe('hydration', () => {
    it.each([
      ['en-US', '1.123456789012345678'],
      ['pl-PL', '1,123456789012345678'],
    ])('hydrates a persisted row from amountExact with every digit in %s', (locale, expected) => {
      const values = normalizeFormValues(
        { priceListItems: [{ id: 'eth', description: 'ETH', amount: FLOAT_AMOUNT, amountExact: EXACT_AMOUNT, currencyCode: 'ETH' }] },
        undefined,
        locale,
      )
      const items = values.priceListItems as Array<Record<string, unknown>>
      expect(items[0].amount).toBe(expected)
      expect(items[0]).not.toHaveProperty('amountExact')
    })

    it('falls back to the float amount when no exact sibling was persisted', () => {
      const values = normalizeFormValues(
        { priceListItems: [{ id: 'usd', description: 'USD', amount: 25.99, currencyCode: 'USD' }] },
        undefined,
        'pl-PL',
      )
      expect((values.priceListItems as Array<Record<string, unknown>>)[0].amount).toBe('25,99')
    })

    it.each([
      ['en-US', '1.123456789012345678'],
      ['pl-PL', '1,123456789012345678'],
    ])('shows every digit of the hydrated row in the price list input in %s', (locale, expected) => {
      mockLocale.current = locale
      const values = normalizeFormValues(persistedRecord() as never, undefined, locale)
      render(
        <PriceListEditor
          value={values.priceListItems as React.ComponentProps<typeof PriceListEditor>['value']}
          onChange={jest.fn()}
        />,
      )
      const amountInput = screen.getByLabelText('checkout.linkTemplateForm.priceList.aria.amount') as HTMLInputElement
      expect(amountInput.value).toBe(expected)
    })
  })

  describe('title-only submit', () => {
    let consoleErrorSpy: jest.SpyInstance

    beforeEach(() => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    })

    afterEach(() => {
      consoleErrorSpy.mockRestore()
    })

    it.each([
      ['link', 'en-US'],
      ['link', 'pl-PL'],
      ['template', 'en-US'],
      ['template', 'pl-PL'],
    ] as const)('sends the exact price list amount for a %s form in %s', async (mode, locale) => {
      mockLocale.current = locale
      const { initialValues, onSubmit } = await renderPersistedForm(mode)
      await act(async () => {
        await onSubmit({ ...initialValues, title: 'Renamed' })
      })
      const body = readSubmittedBody()
      expect(body.title).toBe('Renamed')
      expect(body.priceListItems).toEqual([
        { id: 'eth', description: 'ETH', amount: EXACT_AMOUNT, currencyCode: 'ETH' },
      ])
    })
  })
})
