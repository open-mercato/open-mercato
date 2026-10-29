/** @jest-environment jsdom */

import * as React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import type { CrudFormProps } from '@open-mercato/ui/backend/CrudForm'
import type { OrganizationScopeChangedDetail } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import CreateCurrencyPage from '../create/page'
import CreateExchangeRatePage from '../../exchange-rates/create/page'

const mockPush = jest.fn()
const mockTranslate = (key: string) => key
let mockScope: OrganizationScopeChangedDetail
let mockFormProps: CrudFormProps<Record<string, unknown>> | null

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => mockScope,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PageBody: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: CrudFormProps<Record<string, unknown>>) => {
    mockFormProps = props
    return null
  },
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

const pages = [
  {
    name: 'currency',
    Component: CreateCurrencyPage,
    apiPath: 'currencies/currencies',
    listPath: '/backend/currencies',
    successKey: 'currencies.flash.created',
    values: {
      code: ' eur ', name: ' Euro ', symbol: ' € ', decimalPlaces: '4',
      thousandsSeparator: ',', decimalSeparator: '.', isBase: true, isActive: false,
    },
    expectedFields: {
      code: 'EUR', name: 'Euro', symbol: '€', decimalPlaces: 4,
      thousandsSeparator: ',', decimalSeparator: '.', isBase: true, isActive: false,
    },
  },
  {
    name: 'exchange rate',
    Component: CreateExchangeRatePage,
    apiPath: 'currencies/exchange-rates',
    listPath: '/backend/exchange-rates',
    successKey: 'exchangeRates.flash.created',
    values: {
      fromCurrencyCode: ' eur ', toCurrencyCode: ' usd ', rate: '1.125',
      date: '2026-10-13T09:30:00.000Z', source: ' Manual ', type: 'buy', isActive: false,
    },
    expectedFields: {
      fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', rate: '1.12500000',
      date: '2026-10-13T09:30:00.000Z', source: 'Manual', type: 'buy', isActive: false,
    },
  },
]

const scopes = [
  { name: 'before scope initializes', scope: { organizationId: null, tenantId: null }, expected: {} },
  { name: 'with only tenant initialized', scope: { organizationId: null, tenantId }, expected: { tenantId } },
  { name: 'with only organization initialized', scope: { organizationId, tenantId: null }, expected: { organizationId } },
  { name: 'after scope initializes', scope: { organizationId, tenantId }, expected: { organizationId, tenantId } },
]

describe.each(pages)('$name create scope', ({ Component, apiPath, listPath, successKey, values, expectedFields }) => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFormProps = null
    jest.mocked(createCrud).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof createCrud>>)
  })

  afterEach(cleanup)

  it.each(scopes)('submits $name without serializing unresolved scope', async ({ scope, expected }) => {
    mockScope = scope
    render(<Component />)
    const onSubmit = mockFormProps?.onSubmit
    expect(onSubmit).toBeDefined()
    await act(async () => {
      await onSubmit?.(values)
    })

    expect(createCrud).toHaveBeenCalledTimes(1)
    const [path, payload] = jest.mocked(createCrud).mock.calls[0]
    expect(path).toBe(apiPath)
    expect(JSON.parse(JSON.stringify(payload))).toEqual({ ...expectedFields, ...expected })
    expect(flash).toHaveBeenCalledWith(successKey, 'success')
    expect(mockPush).toHaveBeenCalledWith(listPath)
  })
})
