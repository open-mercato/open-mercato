/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_POLICY } from '@open-mercato/web-research'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import WebSearchSettingsPage from '../page'

const mockTranslate = createTranslator({})
const mockApiCall = jest.fn()
const mockFlash = jest.fn()
const mockRunMutation = jest.fn(async ({ operation }: { operation: () => Promise<void> }) => operation())

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: ['agent_orchestrator.*'] } }),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: mockRunMutation }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => mockFlash(...args) }))
jest.mock('@open-mercato/ui/backend/detail', () => ({ ErrorMessage: () => null }))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PageBody: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PageHeader: () => null,
}))
jest.mock('../AdapterRow', () => ({
  AdapterRow: ({ options, onOption }: { options: Record<string, unknown>; onOption: (field: string, value: unknown) => void }) => <>
    <input aria-label="Adapter key" value={String(options.apiKey ?? '')} onChange={(event) => onOption('apiKey', event.target.value)} />
    <input aria-label="Adapter URL" value={String(options.baseUrl ?? '')} onChange={(event) => onOption('baseUrl', event.target.value)} />
  </>,
}))
jest.mock('../WebSearchPreview', () => ({ WebSearchPreview: () => null }))

beforeEach(() => jest.clearAllMocks())

it('submits only the edited field and clears dirty state after a guarded save', async () => {
  const settings = {
    policy: { ...DEFAULT_POLICY, adapters: [] },
    guardrails: { allowDomains: [], denyDomains: [], allowPrivateHosts: [], searchesPerRun: 20, fetchesPerRun: 40, callsPerTenantPerMinute: 120, maxFetchBytes: 65536 },
    installed: [],
    source: 'tenant',
  }
  mockApiCall.mockImplementation(async (url: string) => ({
    ok: true,
    result: url.includes('/health') ? { adapters: [] } : settings,
  }))
  render(<WebSearchSettingsPage />)
  const label = await screen.findByText('Concurrent adapters')
  const input = label.parentElement?.querySelector('input')
  if (!input) throw new Error('[internal] Missing concurrency input')
  fireEvent.change(input, { target: { value: '4' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(mockRunMutation).toHaveBeenCalledTimes(1))
  const writes = mockApiCall.mock.calls.filter(([, options]) => options?.method === 'PUT')
  expect(writes).toHaveLength(1)
  expect(JSON.parse(writes[0][1].body)).toEqual({ concurrency: 4 })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true))
})


it('masks a just-saved key so a subsequent URL edit requires credential re-entry', async () => {
  const adapter = {
    id: 'exa', kind: 'api', packageName: 'fixture-exa', configured: true, configurationHint: null,
    fields: [{ name: 'apiKey', kind: 'string', secret: true }, { name: 'baseUrl', kind: 'string', secret: false }],
    options: { apiKey: '__om_secret_unchanged__', baseUrl: 'https://original.example' },
  }
  const settings = {
    policy: { ...DEFAULT_POLICY, adapters: [{ id: 'exa', enabled: true, order: 0, weight: 1 }] },
    guardrails: { allowDomains: [], denyDomains: [], allowPrivateHosts: [], searchesPerRun: 20, fetchesPerRun: 40, callsPerTenantPerMinute: 120, maxFetchBytes: 65536 },
    installed: [adapter], source: 'tenant',
  }
  mockApiCall.mockImplementation(async (url: string, options?: { body?: string; method?: string }) => {
    if (options?.method === 'PUT' && options.body?.includes('https://new.example')) {
      return { ok: false, result: { error: 'Re-enter credentials when changing an adapter URL.' } }
    }
    return { ok: true, result: url.includes('/health') ? { adapters: [] } : settings }
  })
  render(<WebSearchSettingsPage />)
  const key = await screen.findByRole('textbox', { name: 'Adapter key' })
  fireEvent.change(key, { target: { value: 'fixture-replacement' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true))
  expect(key).toHaveProperty('value', '__om_secret_unchanged__')
  fireEvent.change(screen.getByRole('textbox', { name: 'Adapter URL' }), { target: { value: 'https://new.example' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(mockRunMutation).toHaveBeenCalledTimes(2))
  const writes = mockApiCall.mock.calls.filter(([, options]) => options?.method === 'PUT')
  expect(JSON.parse(writes[1][1].body)).toEqual({
    adapterOptions: { exa: { apiKey: '__om_secret_unchanged__', baseUrl: 'https://new.example' } },
  })
  expect(mockFlash).toHaveBeenCalledWith('Re-enter credentials when changing an adapter URL.', 'error')
})
