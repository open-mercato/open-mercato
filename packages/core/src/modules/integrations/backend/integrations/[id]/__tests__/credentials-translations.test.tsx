/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()
const flashMock = jest.fn()

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/integrations/gateway_stripe',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
  RecordNotFoundState: ({ label }: { label: string }) => <div>{label}</div>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return {
    ...actual,
    apiCall: (...args: unknown[]) => apiCallMock(...args),
    withScopedApiRequestHeaders: (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
  }
})

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn().mockResolvedValue(true), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/custom-fields/FieldDefinitionsManager', () => {
  const ReactLocal = require('react')
  return {
    __esModule: true,
    FieldDefinitionsManager: ReactLocal.forwardRef(() => <div>Field definitions manager</div>),
  }
})
jest.mock('@open-mercato/ui/backend/utils/customFieldForms', () => ({
  __esModule: true,
  buildFormFieldFromCustomFieldDef: jest.fn(),
  buildFormFieldsFromCustomFields: jest.fn(() => []),
  fetchCustomFieldFormStructure: jest.fn(async () => ({
    fields: [],
    definitions: [],
    metadata: { items: [], fieldsetsByEntity: {}, entitySettings: {} },
  })),
}))


import IntegrationDetailPage from '../page'
import { translateCredentialFields } from '../../credential-translations'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'
import integrationPl from '../../../../i18n/pl.json'
import { integration as gateway_tpay } from '../../../../../../../../gateway-tpay/src/modules/gateway_tpay/integration'
import gateway_tpayPl from '../../../../../../../../gateway-tpay/src/modules/gateway_tpay/i18n/pl.json'
import gateway_tpayEn from '../../../../../../../../gateway-tpay/src/modules/gateway_tpay/i18n/en.json'
import { integration as gateway_stripe } from '../../../../../../../../gateway-stripe/src/modules/gateway_stripe/integration'
import gateway_stripePl from '../../../../../../../../gateway-stripe/src/modules/gateway_stripe/i18n/pl.json'
import gateway_stripeEn from '../../../../../../../../gateway-stripe/src/modules/gateway_stripe/i18n/en.json'
import { integration as sync_akeneo } from '../../../../../../../../sync-akeneo/src/modules/sync_akeneo/integration'
import sync_akeneoPl from '../../../../../../../../sync-akeneo/src/modules/sync_akeneo/i18n/pl.json'
import sync_akeneoEn from '../../../../../../../../sync-akeneo/src/modules/sync_akeneo/i18n/en.json'

const dict = { ...integrationPl, ...gateway_tpayPl, ...gateway_stripePl, ...sync_akeneoPl, 'ui.webhookGuide.showDetails': 'Pokaż szczegóły' }
const version = '2026-11-19T10:00:00.000Z'

function reply(result: unknown) {
  return { ok: true, status: 200, result, response: { ok: true, status: 200, headers: new Headers() } }
}

function mockProvider(provider: IntegrationDefinition) {
  const fields = provider.credentials!.fields
  const secretFieldsConfigured = Object.fromEntries(fields.filter((field) => field.type === 'secret').map((field) => [field.key, true]))
  const credentials = Object.fromEntries(fields.map((field) => [field.key,
    field.type === 'secret' ? '__om_secret_unchanged__'
      : field.type === 'select' ? field.options[0].value
        : field.type === 'url' ? 'https://synthetic.example.test'
          : 'synthetic-client',
  ]))
  apiCallMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/api/auth/feature-check')) {
      return reply({ ok: true, granted: ['integrations.credentials.manage'], userId: 'synthetic-user' })
    }
    if (url.endsWith('/credentials')) {
      if (init?.method === 'PUT') return reply({ ok: true })
      return reply({ credentials, secretFieldsConfigured, updatedAt: version })
    }
    if (url.includes('/logs')) return reply({ items: [] })
    return reply({
      integration: provider,
      state: { isEnabled: false, apiVersion: null, reauthRequired: false, lastHealthStatus: null, lastHealthCheckedAt: null, lastHealthLatencyMs: null, enabledAt: null, updatedAt: version },
      hasCredentials: true,
      credentialsUpdatedAt: version,
      healthStatus: 'unconfigured',
      analytics: { lastActivityAt: null, totalCount: 0, errorCount: 0, errorRate: 0, dailyCounts: [] },
    })
  })
}

describe('Polish integration credential forms (#9966)', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    flashMock.mockReset()
  })

  it.each([gateway_tpay, gateway_stripe, sync_akeneo])('renders $id copy in Polish and preserves saved secrets on submit', async (provider) => {
    mockProvider(provider)
    const { container, getByText } = renderWithProviders(<IntegrationDetailPage params={{ id: provider.id }} />, { dict, locale: 'pl' })
    await waitFor(() => expect(container.querySelector('form')).not.toBeNull())
    expect(container).toHaveTextContent(dict[`${provider.id}.description` as keyof typeof dict])
    expect(container).toHaveTextContent(integrationPl[`integrations.marketplace.categories.${provider.category}` as keyof typeof integrationPl])
    expect(container).toHaveTextContent(integrationPl[`integrations.hubs.${provider.hub}` as keyof typeof integrationPl])
    for (const field of provider.credentials!.fields) {
      const element = container.querySelector(`[data-crud-field-id="${field.key}"]`)!
      expect(element).toHaveTextContent(dict[`${provider.id}.credentials.${field.key}.label` as keyof typeof dict])
      expect(element).toHaveTextContent(dict[`${provider.id}.credentials.${field.key}.helpText` as keyof typeof dict])
      if (field.type === 'secret') {
        expect(element.querySelector('input')).toHaveValue('')
        expect(element.querySelector('input')).toHaveAttribute('type', 'password')
        expect(element).toHaveTextContent(integrationPl['integrations.detail.credentials.secretConfigured'])
      }
    }
    expect(container).not.toHaveTextContent('__om_secret_unchanged__')
    if (provider.id === 'gateway_tpay') {
      const options = container.querySelectorAll('[data-crud-field-id="environment"] option')
      expect(Array.from(options).map((option) => [option.getAttribute('value'), option.textContent])).toEqual([
        ['sandbox', 'Testowe'], ['production', 'Produkcyjne'],
      ])
    }
    if (provider.id === 'gateway_stripe') {
      fireEvent.click(getByText('Pokaż szczegóły'))
      expect(container).toHaveTextContent(gateway_stripePl['gateway_stripe.credentials.webhookSecret.helpDetails.title'])
      for (const step of [0, 1, 2, 3, 4]) {
        expect(container).toHaveTextContent(gateway_stripePl[`gateway_stripe.credentials.webhookSecret.helpDetails.steps.${step}` as keyof typeof gateway_stripePl])
      }
      expect(container).toHaveTextContent('payment_intent.succeeded')
      expect(container).toHaveTextContent('/api/payment_gateways/webhook/stripe')
      expect(container).toHaveTextContent('ngrok http 3000')
    }
    await act(async () => { fireEvent.submit(container.querySelector('form')!) })
    await waitFor(() => expect(apiCallMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true))
    const [, init] = apiCallMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    const body = JSON.parse(init.body)
    expect(body.unchangedSecretFields).toEqual(provider.credentials!.fields.filter((field) => field.type === 'secret').map((field) => field.key))
    for (const key of body.unchangedSecretFields) expect(body.credentials).not.toHaveProperty(key)
    if (provider.id === 'gateway_tpay') expect(body.credentials.environment).toBe('sandbox')
  })

  it('uses the localized field name in URL validation and prevents an invalid save', async () => {
    mockProvider(sync_akeneo)
    const { container } = renderWithProviders(<IntegrationDetailPage params={{ id: 'sync_akeneo' }} />, { dict, locale: 'pl' })
    await waitFor(() => expect(container.querySelector('form')).not.toBeNull())
    fireEvent.change(container.querySelector('[data-crud-field-id="apiUrl"] input')!, { target: { value: 'invalid-synthetic-url' } })
    await act(async () => { fireEvent.submit(container.querySelector('form')!) })
    await waitFor(() => expect(container).toHaveTextContent('Pole „Adres URL Akeneo” musi zawierać prawidłowy adres URL http(s).'))
    expect(apiCallMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })
})

const englishDict = { ...gateway_tpayEn, ...gateway_stripeEn, ...sync_akeneoEn }

it.each([gateway_tpay, gateway_stripe, sync_akeneo])('preserves $id schema and English fallback copy', (provider) => {
  const originalFields = JSON.parse(JSON.stringify(provider.credentials!.fields))
  const fields = provider.credentials!.fields
  expect(translateCredentialFields(fields, provider.id, createTranslator({}))).toEqual(originalFields)
  expect(translateCredentialFields(fields, provider.id, createTranslator(englishDict))).toEqual(originalFields)
  const localized = translateCredentialFields(fields, provider.id, createTranslator(dict))
  expect(provider.credentials!.fields).toEqual(originalFields)
  for (const field of localized) {
    const original = fields.find((candidate) => candidate.key === field.key)!
    expect(field.label).not.toBe(original.label)
    expect(field.helpText).not.toBe(original.helpText)
    expect(field.type).toBe(original.type)
    expect(field.required).toBe(original.required)
    expect(field.placeholder).toBe(original.placeholder)
    if (field.helpDetails) {
      expect(field.helpDetails.endpointPath).toBe(original.helpDetails!.endpointPath)
      expect(field.helpDetails.events).toEqual(original.helpDetails!.events)
      expect(field.helpDetails.localDevelopment!.tunnelCommand).toBe(original.helpDetails!.localDevelopment!.tunnelCommand)
      expect(field.helpDetails.localDevelopment!.publicUrlExample).toBe(original.helpDetails!.localDevelopment!.publicUrlExample)
    }
  }
})
