/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'

const mockApiFetch = jest.fn()
const mockRunMutation = jest.fn()
const mockConfirm = jest.fn()
const mockFlash = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (input: { operation: () => Promise<unknown> }) => mockRunMutation(input),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: (...args: unknown[]) => mockConfirm(...args), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/backend',
  useSearchParams: () => new URLSearchParams(),
}))

import { XrayVariantDraftDialog } from '../XrayVariantDraftDialog'
import ProcessHealthWidget, { loadProcessHealth } from '../../../widgets/dashboard/process-health/widget.client'
import type { XrayVariantItem } from '../../../lib/client/xray/types'
import { DEFINITION_ID, envelope, fakeResponse, recordRequest, renderXray, type RecordedRequest } from './xrayTestSupport'

const HASH = 'a'.repeat(64)
const requests: RecordedRequest[] = []

function respond(handler: (request: RecordedRequest) => { status: number; body: unknown }) {
  mockApiFetch.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const request = recordRequest(input, init)
    requests.push(request)
    const { status, body } = handler(request)
    return fakeResponse(status, body)
  })
}

beforeEach(() => {
  requests.length = 0
  mockApiFetch.mockReset()
  mockRunMutation.mockReset()
  mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
  mockConfirm.mockReset()
  mockConfirm.mockResolvedValue(true)
  mockFlash.mockReset()
})

const VARIANT: XrayVariantItem = {
  variantHash: HASH,
  rawVariantHashes: [HASH],
  rawVariantHashesTruncated: false,
  activityKeys: ['created', 'status:open', 'status:win'],
  cases: 12,
  share: 0.5,
  cycleTime: { n: 12, medianMs: 3_600_000, p90Ms: null, lowConfidence: true },
}

const DRAFT = {
  ok: true,
  persisted: false,
  processKey: 'customers.deal',
  variantHash: HASH,
  variantCases: 12,
  window: envelope.window,
  n: 24,
  computedThrough: envelope.computedThrough,
  incomplete: false,
  payload: {
    workflowId: 'xray.v.customers.deal.aaaa',
    workflowName: 'Deal: observed path',
    enabled: false,
    lifecycle: 'draft',
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'status_open', stepName: 'Set status to open', stepType: 'AUTOMATED', activities: [{ activityType: 'UPDATE_ENTITY', config: { commandId: 'customers.deals.update', input: { id: '{{context.recordId}}', status: 'open' } } }] },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      triggers: [],
    },
  },
  activityStepMap: { 'status:open': 'status_open' },
  skippedActivities: ['created'],
  activityLabels: { created: 'Deal created', 'status:open': 'Status: Open', 'status:win': 'Status: Won' },
  commands: [{ commandId: 'customers.deals.update', requiredFeatures: ['customers.deals.manage'], enabled: false }],
  workflowIdAvailable: true,
}

describe('XrayVariantDraftDialog', () => {
  it('previews the draft for the chosen command, then creates it disabled after confirmation (no command lookup without workflows.definitions.edit)', async () => {
    respond((request) => {
      if (request.url.pathname === '/api/workflows/commands') return { status: 403, body: { error: 'Insufficient permissions' } }
      if (request.url.pathname.endsWith('/workflow-draft')) return { status: 200, body: DRAFT }
      if (request.url.pathname === '/api/workflows/definitions') return { status: 201, body: { data: { id: DEFINITION_ID } } }
      return { status: 404, body: {} }
    })
    renderXray(
      <XrayVariantDraftDialog
        processKey="customers.deal"
        variant={VARIANT}
        activityLabels={{ created: 'Created', 'status:open': 'Status: Open', 'status:win': 'Status: Won' }}
        window={{ kind: 'preset', key: '30d' }}
        permissions={{ canManage: true, canViewIndividuals: false, canCreateWorkflows: true, canEditWorkflows: false, canViewWorkflows: true, loading: false }}
        onClose={jest.fn()}
      />,
    )
    const dialog = await screen.findByTestId('xray-variant-draft-dialog')
    const commandInput = await within(dialog).findByPlaceholderText('module.entity.update')
    expect(dialog).toHaveTextContent('Created → Status: Open → Status: Won')
    expect(within(dialog).getByTestId('xray-commands-unavailable')).toHaveTextContent('workflows.definitions.edit')
    expect(requests.some((request) => request.url.pathname === '/api/workflows/commands')).toBe(false)
    expect(screen.getByTestId('xray-draft-preview')).toBeDisabled()
    await act(async () => {
      fireEvent.change(commandInput, { target: { value: 'customers.deals.update' } })
    })
    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true })
    })
    const summary = await screen.findByTestId('xray-draft-summary')
    const preview = requests.find((request) => request.url.pathname.endsWith('/workflow-draft'))
    expect(preview?.method).toBe('POST')
    expect(preview?.url.pathname).toBe(`/api/insights/xray/customers.deal/variants/${HASH}/workflow-draft`)
    expect(preview?.body).toEqual({ window: '30d', commandId: 'customers.deals.update' })
    expect(mockRunMutation).not.toHaveBeenCalled()
    expect(summary).toHaveTextContent('Not part of the draft: Deal created')
    expect(summary).toHaveTextContent('Command not enabled for workflows')

    await act(async () => {
      fireEvent.click(screen.getByTestId('xray-draft-create'))
    })
    await screen.findByTestId('xray-draft-created')
    const create = requests.find((request) => request.url.pathname === '/api/workflows/definitions')
    expect(create?.method).toBe('POST')
    expect(create?.body).toEqual(DRAFT.payload)
    expect(mockConfirm).toHaveBeenCalledTimes(1)
    expect(mockRunMutation).toHaveBeenCalledTimes(1)
  })

  it('shows why a variant cannot be drafted', async () => {
    respond((request) => {
      if (request.url.pathname === '/api/workflows/commands') return { status: 200, body: { items: [] } }
      return { status: 422, body: { error: 'translated', code: 'variant_not_draftable', hint: null } }
    })
    renderXray(
      <XrayVariantDraftDialog
        processKey="customers.deal"
        variant={VARIANT}
        window={{ kind: 'preset', key: '30d' }}
        permissions={{ canManage: true, canViewIndividuals: false, canCreateWorkflows: true, canEditWorkflows: true, canViewWorkflows: true, loading: false }}
        onClose={jest.fn()}
      />,
    )
    const input = await screen.findByPlaceholderText('module.entity.update')
    const commandsLookup = requests.find((request) => request.url.pathname === '/api/workflows/commands')
    expect(commandsLookup?.headers['x-om-forbidden-redirect']).toBe('0')
    expect(screen.queryByTestId('xray-commands-unavailable')).toBeNull()
    await act(async () => {
      fireEvent.change(input, { target: { value: 'customers.deals.update' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('xray-draft-preview'))
    })
    expect(await screen.findByText('This variant has no stage changes that a workflow could perform.')).toBeInTheDocument()
    expect(screen.queryByTestId('xray-draft-create')).toBeNull()
  })
})

describe('Process health dashboard widget', () => {
  function routeHealth() {
    respond((request) => {
      if (request.url.pathname === '/api/insights/xray/processes') {
        return {
          status: 200,
          body: {
            items: [
              { processKey: 'customers.deal', labelKey: 'customers.insights.process.deal', moduleId: 'customers', resourceKind: 'customers.deal', organizationIds: null, window: envelope.window, n: 42, lowConfidence: false, computedThrough: envelope.computedThrough, incomplete: false, kAnonymity: 5, openCases: null, openCasesAsOf: envelope.window.to },
              { processKey: 'sales.order', labelKey: 'sales.order', moduleId: 'sales', resourceKind: 'sales.order', organizationIds: null, window: envelope.window, n: 0, lowConfidence: true, computedThrough: envelope.computedThrough, incomplete: false, kAnonymity: 5, openCases: 0, openCasesAsOf: envelope.window.to },
            ],
            n: 42,
            computedThrough: envelope.computedThrough,
            incomplete: false,
          },
        }
      }
      if (request.url.pathname.endsWith('/durations')) {
        return { status: 200, body: { ...envelope, includeSyncRun: false, truncatedCases: 0, completed: { empty: false, stats: { n: 4, medianMs: null, p90Ms: null, lowConfidence: true }, histogram: [], excludedSyncRun: 0 }, open: null, byOrganization: [] } }
      }
      if (request.url.pathname.endsWith('/bottlenecks')) {
        return { status: 200, body: { ...envelope, includeSyncRun: false, transitions: { raw: 1, collapsed: 1, measured: 1, excludedSyncRun: 0 }, items: [{ from: 'status:open', to: 'status:win', transitions: 9, rawTransitions: 9, cases: 9, wait: { n: 9, medianMs: 2 * 86_400_000, p90Ms: null, lowConfidence: true }, totalWaitMs: null }], omitted: 0, activityLabels: { 'status:open': 'Status: Open', 'status:win': 'Status: Won' } } }
      }
      return { status: 404, body: {} }
    })
  }

  it('loads the busiest processes in the 30-day window and only analyses those with cases', async () => {
    routeHealth()
    const data = await loadProcessHealth()
    expect(data.rows.map((row) => row.process.processKey)).toEqual(['customers.deal', 'sales.order'])
    expect(requests.map((request) => `${request.url.pathname}?${request.url.searchParams.toString()}`).sort()).toEqual([
      '/api/insights/xray/customers.deal/bottlenecks?window=30d',
      '/api/insights/xray/customers.deal/durations?window=30d',
      '/api/insights/xray/processes?window=30d',
    ])
  })

  it('shows cases, hidden open cases, the n guard of the median and the longest wait', async () => {
    routeHealth()
    renderXray(
      <ProcessHealthWidget
        mode="view"
        layout={{ id: 'w1', widgetId: 'insights.dashboard.processHealth', order: 0 }}
        settings={{}}
        context={{ userId: 'u1' }}
        onSettingsChange={jest.fn()}
        refreshToken={0}
      />,
    )
    const rows = await screen.findAllByTestId('xray-process-health-row')
    const deal = rows[0]
    expect(deal).toHaveTextContent('Deal')
    expect(deal).toHaveTextContent('42')
    expect(deal).toHaveTextContent('Hidden (privacy)')
    expect(deal).toHaveTextContent('Needs at least 5 cases (n = 4)')
    expect(deal).toHaveTextContent('Longest wait: Status: Open → Status: Won (2 d)')
    expect(within(deal).getByRole('link', { name: 'Deal' })).toHaveAttribute('href', '/backend/insights/process-xray/customers.deal?w=30d')
    await waitFor(() => expect(rows[1]).toHaveTextContent('Low confidence'))
  })
})
