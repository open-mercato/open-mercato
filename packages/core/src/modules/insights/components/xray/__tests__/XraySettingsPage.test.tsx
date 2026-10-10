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

beforeEach(() => {
  requests.length = 0
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
