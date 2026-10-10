/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'

const mockApiFetch = jest.fn()
const mockFlash = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
  usePathname: () => '/backend/insights/process-xray/settings',
  useSearchParams: () => new URLSearchParams(),
}))

import { XraySettingsPageClient, settingsPayloadOf } from '../XraySettingsPage.client'
import { OPTIMISTIC_LOCK_HEADER, ORG_ID, fakeResponse, recordRequest, renderXray, type RecordedRequest } from './xrayTestSupport'

const UPDATED_AT = '2026-10-10T08:00:00.123Z'

const SETTINGS = {
  enabled: true,
  retentionDays: 365,
  kAnonymity: 10,
  debounceSeconds: 120,
  individualsEnabled: false,
  timeZone: 'UTC',
  suggestionMinSupport: null,
  conformanceWorkflowId: null,
  activityStepMap: { 'status:won': 'won_step' },
  updatedAt: UPDATED_AT,
}

const STATUS = {
  organizationId: ORG_ID,
  ingestEnabled: true,
  settings: SETTINGS,
  registry: { ready: true, contractHash: 'hash', processes: [{ processKey: 'customers.deal', labelKey: 'customers.insights.process.deal', moduleId: 'customers' }], rejected: 0 },
  cursor: null,
  processes: [],
  countsTimedOut: false,
  computedThrough: null,
  coverageFrom: null,
}

const requests: RecordedRequest[] = []
const granted: { features: string[] } = { features: [] }

beforeEach(() => {
  requests.length = 0
  granted.features = ['insights.xray.view', 'insights.xray.manage', 'workflows.definitions.view']
  mockFlash.mockReset()
  mockApiFetch.mockReset()
  mockApiFetch.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const request = recordRequest(input, init)
    requests.push(request)
    if (request.url.pathname === '/api/insights/xray/settings' && request.method === 'PUT') {
      return fakeResponse(200, { ok: true, result: { ...SETTINGS, ...(request.body as object), updatedAt: '2026-10-10T08:05:00.000Z' } })
    }
    if (request.url.pathname === '/api/insights/xray/settings') return fakeResponse(200, { ok: true, result: SETTINGS })
    if (request.url.pathname === '/api/insights/xray/status') return fakeResponse(200, STATUS)
    if (request.url.pathname === '/api/auth/feature-check') return fakeResponse(200, { ok: true, granted: granted.features })
    if (request.url.pathname.startsWith('/api/workflows/definitions')) {
      return fakeResponse(200, { data: [{ id: '55555555-0000-4000-8000-000000000001', workflowId: 'deal_flow', workflowName: 'Deal flow', version: 2 }] })
    }
    return fakeResponse(200, { items: [], data: [] })
  })
})

describe('XraySettingsPageClient', () => {
  it('saves through CrudForm with the optimistic-lock header of the loaded settings version', async () => {
    renderXray(<XraySettingsPageClient />)
    const retention = await screen.findByDisplayValue('365')
    await act(async () => {
      fireEvent.change(retention, { target: { value: '400' } })
    })
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Save settings' })[0])
    })
    await waitFor(() => expect(requests.some((request) => request.method === 'PUT')).toBe(true))
    const put = requests.find((request) => request.method === 'PUT')
    expect(put?.url.pathname).toBe('/api/insights/xray/settings')
    expect(put?.headers[OPTIMISTIC_LOCK_HEADER]).toBe(UPDATED_AT)
    expect(put?.body).toEqual(expect.objectContaining({
      retentionDays: 400,
      kAnonymity: 10,
      individualsEnabled: false,
      suggestionMinSupport: null,
      conformanceWorkflowId: null,
      activityStepMap: { 'status:won': 'won_step' },
    }))
    expect(put?.body).not.toHaveProperty('updatedAt')
    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('Process X-Ray settings saved.', 'success'))
  })

  it('shows the privacy warning only while per-person analytics are allowed', async () => {
    renderXray(<XraySettingsPageClient />)
    await screen.findByDisplayValue('365')
    expect(screen.queryByTestId('xray-individuals-warning')).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /Allow per-person analytics/ }))
    })
    expect(await screen.findByTestId('xray-individuals-warning')).toHaveTextContent('can be used to monitor employees')
  })

  it('never looks up workflow definitions without workflows.definitions.view: inline hint, disabled field, the form still saves', async () => {
    granted.features = ['insights.xray.view', 'insights.xray.manage']
    renderXray(<XraySettingsPageClient />)
    const retention = await screen.findByDisplayValue('365')
    expect(await screen.findByTestId('xray-settings-workflow-unavailable')).toHaveTextContent('workflows.definitions.view')
    const field = document.querySelector<HTMLElement>('[data-crud-field-id="conformanceWorkflowId"]')
    expect(field?.querySelector('input')).toBeDisabled()
    await act(async () => {
      fireEvent.change(retention, { target: { value: '400' } })
    })
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Save settings' })[0])
    })
    await waitFor(() => expect(requests.some((request) => request.method === 'PUT')).toBe(true))
    expect(requests.some((request) => request.url.pathname.startsWith('/api/workflows/'))).toBe(false)
    expect(mockFlash).not.toHaveBeenCalledWith(expect.stringMatching(/Access denied/), expect.anything())
  })

  it('loads the workflow picker with the caller holding workflows.definitions.view, as an optional lookup that never raises the access-denied banner', async () => {
    renderXray(<XraySettingsPageClient />)
    await screen.findByDisplayValue('365')
    await waitFor(() => expect(requests.some((request) => request.url.pathname === '/api/workflows/definitions')).toBe(true))
    const lookup = requests.find((request) => request.url.pathname === '/api/workflows/definitions')
    expect(lookup?.headers['x-om-forbidden-redirect']).toBe('0')
    expect(screen.queryByTestId('xray-settings-workflow-unavailable')).toBeNull()
  })

  it('renders the projection status with the backfill action', async () => {
    renderXray(<XraySettingsPageClient />)
    expect(await screen.findByTestId('xray-backfill')).toHaveTextContent('Backfill history')
    expect(await screen.findByText('Not started')).toBeInTheDocument()
  })
})

describe('settingsPayloadOf', () => {
  it('sends only declared keys and empty optional values as null', () => {
    expect(settingsPayloadOf({
      enabled: true,
      retentionDays: 30,
      kAnonymity: 5,
      debounceSeconds: 0,
      individualsEnabled: true,
      timeZone: ' Europe/Warsaw ',
      suggestionMinSupport: '',
      conformanceWorkflowId: '',
      activityStepMap: {},
      updatedAt: UPDATED_AT,
    })).toEqual({
      enabled: true,
      retentionDays: 30,
      kAnonymity: 5,
      debounceSeconds: 0,
      individualsEnabled: true,
      timeZone: 'Europe/Warsaw',
      suggestionMinSupport: null,
      conformanceWorkflowId: null,
      activityStepMap: null,
    })
  })
})
