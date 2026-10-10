/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'

const mockApiFetch = jest.fn()
const mockRunMutation = jest.fn()
const mockRetryLastMutation = jest.fn()
const mockSurfaceRecordConflict = jest.fn()
const mockFlash = jest.fn()
const mockConfirm = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (input: { operation: () => Promise<unknown> }) => mockRunMutation(input),
    retryLastMutation: mockRetryLastMutation,
  }),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => mockSurfaceRecordConflict(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: (...args: unknown[]) => mockConfirm(...args), ConfirmDialogElement: null }),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/backend/insights/process-xray/suggestions',
  useSearchParams: () => new URLSearchParams(),
}))

import { XraySuggestionsSection } from '../XraySuggestionsSection'
import { XraySuggestionReviewDialog } from '../XraySuggestionReviewDialog'
import type { XrayPermissions } from '../../../lib/client/xray/hooks'
import type { XraySuggestion } from '../../../lib/client/xray/types'
import {
  DEFINITION_ID,
  OPTIMISTIC_LOCK_HEADER,
  ORG_ID,
  SUGGESTION_ID,
  fakeResponse,
  recordRequest,
  renderXray,
  type RecordedRequest,
} from './xrayTestSupport'

const UPDATED_AT = '2026-10-10T08:00:00.123Z'

const PERMISSIONS: XrayPermissions = {
  canManage: true,
  canViewIndividuals: false,
  canCreateWorkflows: true,
  canEditWorkflows: true,
  canViewWorkflows: true,
  loading: false,
}

function suggestion(overrides: Partial<XraySuggestion> = {}): XraySuggestion {
  return {
    id: SUGGESTION_ID,
    processKey: 'customers.deal',
    processLabelKey: 'customers.insights.process.deal',
    organizationId: ORG_ID,
    status: 'open',
    trigger: { activityKey: 'created', activityKind: 'lifecycle', field: null, value: null, eventId: 'customers.deal.created' },
    condition: null,
    followups: [{ field: 'status', value: 'qa_review', activityKind: 'stage', commandId: 'customers.deals.update' }],
    windowSeconds: 600,
    support: 9,
    triggerCount: 9,
    confidence: 0.701,
    lift: 3.5,
    distinctActorCount: 3,
    draftable: true,
    notDraftableReason: null,
    draftedArtifactId: null,
    computedAt: '2026-10-10T07:00:00.000Z',
    createdAt: '2026-10-10T07:00:00.000Z',
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

const DRAFT_PAYLOAD = {
  workflowId: 'xray.s.customers.deal.abcdef',
  workflowName: 'Deal: set status to qa_review',
  enabled: false,
  lifecycle: 'draft',
  definition: {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      { stepId: 'set_status_1', stepName: 'Set status to qa_review', stepType: 'AUTOMATED', activities: [{ activityType: 'UPDATE_ENTITY', config: { commandId: 'customers.deals.update', input: { id: '{{context.recordId}}', status: 'qa_review' } } }] },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    triggers: [{ eventPattern: 'customers.deal.created', config: {} }],
  },
}

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
  mockRetryLastMutation.mockReset()
  mockSurfaceRecordConflict.mockReset()
  mockSurfaceRecordConflict.mockReturnValue(true)
  mockFlash.mockReset()
  mockConfirm.mockReset()
  mockConfirm.mockResolvedValue(true)
})

describe('XraySuggestionsSection', () => {
  it('lists suggestions with their statistics and never anybody\'s identity', async () => {
    respond(() => ({ status: 200, body: { items: [suggestion()], total: 1, page: 1, pageSize: 20, totalPages: 1 } }))
    renderXray(<XraySuggestionsSection permissions={PERMISSIONS} />)
    expect(await screen.findByText('After Created, people set status: qa_review')).toBeInTheDocument()
    expect(screen.getByText('9 of 9')).toBeInTheDocument()
    expect(screen.getByText('70%')).toBeInTheDocument()
    const listRequest = requests[0]
    expect(listRequest.url.pathname).toBe('/api/insights/xray/suggestions')
    expect(Object.fromEntries(listRequest.url.searchParams)).toEqual({ status: 'open', page: '1', pageSize: '20' })
  })

  it('dismisses with the optimistic-lock header of the shown version and surfaces a 409 conflict', async () => {
    respond((request) => {
      if (request.method === 'PATCH') {
        return {
          status: 409,
          body: { error: 'record_modified', code: 'optimistic_lock_conflict', currentUpdatedAt: '2026-10-10T09:00:00.000Z', expectedUpdatedAt: UPDATED_AT },
        }
      }
      return { status: 200, body: { items: [suggestion()], total: 1, page: 1, pageSize: 20, totalPages: 1 } }
    })
    renderXray(<XraySuggestionsSection permissions={PERMISSIONS} />)
    await screen.findByText('After Created, people set status: qa_review')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open actions' }))
    })
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Dismiss' }))
    })
    await waitFor(() => expect(mockSurfaceRecordConflict).toHaveBeenCalledTimes(1))
    const patch = requests.find((request) => request.method === 'PATCH')
    expect(patch?.url.pathname).toBe(`/api/insights/xray/suggestions/${SUGGESTION_ID}`)
    expect(patch?.body).toEqual({ status: 'dismissed' })
    expect(patch?.headers[OPTIMISTIC_LOCK_HEADER]).toBe(UPDATED_AT)
    const [error] = mockSurfaceRecordConflict.mock.calls[0] as [{ status: number; code: string }]
    expect(error).toEqual(expect.objectContaining({ status: 409, code: 'optimistic_lock_conflict' }))
    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ resourceKind: 'insights.xray_suggestion', retryLastMutation: mockRetryLastMutation }),
      mutationPayload: { status: 'dismissed' },
    }))
    expect(mockFlash).not.toHaveBeenCalledWith(expect.anything(), 'success')
  })

  it('hides manager actions from viewers', async () => {
    respond(() => ({ status: 200, body: { items: [suggestion({ draftable: false, notDraftableReason: 'trigger_not_expressible' })], total: 1, page: 1, pageSize: 20, totalPages: 1 } }))
    renderXray(<XraySuggestionsSection permissions={{ ...PERMISSIONS, canManage: false }} />)
    expect(await screen.findByText(/Its trigger is not an event a workflow can start on/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open actions' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Look for suggestions now' })).toBeNull()
  })
})

describe('XraySuggestionReviewDialog', () => {
  function routeDraftFlow() {
    respond((request) => {
      if (request.url.pathname.endsWith('/draft')) {
        return { status: 200, body: { ok: true, persisted: false, suggestionId: SUGGESTION_ID, processKey: 'customers.deal', draftable: true, reason: null, payload: DRAFT_PAYLOAD, commands: [{ commandId: 'customers.deals.update', requiredFeatures: ['customers.deals.manage'], enabled: true }], workflowIdAvailable: true } }
      }
      if (request.url.pathname === '/api/workflows/definitions') {
        return { status: 201, body: { data: { id: DEFINITION_ID, workflowId: DRAFT_PAYLOAD.workflowId } } }
      }
      if (request.method === 'PATCH') {
        return { status: 200, body: { ok: true, result: suggestion({ status: 'drafted', draftedArtifactId: DEFINITION_ID, updatedAt: '2026-10-10T08:01:00.000Z' }) } }
      }
      return { status: 404, body: { error: 'not found' } }
    })
  }

  function renderDialog(overrides: Partial<React.ComponentProps<typeof XraySuggestionReviewDialog>> = {}) {
    const onClose = jest.fn()
    const onUpdated = jest.fn()
    renderXray(<XraySuggestionReviewDialog suggestion={suggestion()} permissions={PERMISSIONS} onClose={onClose} onUpdated={onUpdated} {...overrides} />)
    return { onClose, onUpdated }
  }

  it('creates the disabled draft as the user, then marks the suggestion drafted with the new definition', async () => {
    routeDraftFlow()
    const { onUpdated } = renderDialog()
    const summary = await screen.findByTestId('xray-draft-summary')
    expect(summary).toHaveTextContent('Deal: set status to qa_review')
    expect(summary).toHaveTextContent('Disabled draft')
    expect(summary).toHaveTextContent('customers.deal.created')
    expect(summary).toHaveTextContent('Runs customers.deals.update and sets status')

    await act(async () => {
      fireEvent.click(screen.getByTestId('xray-draft-create'))
    })
    await screen.findByTestId('xray-draft-created')
    expect(mockConfirm).toHaveBeenCalledTimes(1)
    const writes = requests.filter((request) => request.method !== 'GET')
    expect(writes.map((request) => `${request.method} ${request.url.pathname}`)).toEqual([
      'POST /api/workflows/definitions',
      `PATCH /api/insights/xray/suggestions/${SUGGESTION_ID}`,
    ])
    expect(writes[0].body).toEqual(DRAFT_PAYLOAD)
    expect(writes[1].body).toEqual({ status: 'drafted', draftedArtifactId: DEFINITION_ID })
    expect(writes[1].headers[OPTIMISTIC_LOCK_HEADER]).toBe(UPDATED_AT)
    expect(mockRunMutation).toHaveBeenCalledTimes(2)
    expect(mockRunMutation.mock.calls[0][0]).toEqual(expect.objectContaining({
      context: expect.objectContaining({ resourceKind: 'workflows.definition', retryLastMutation: mockRetryLastMutation }),
    }))
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'drafted', draftedArtifactId: DEFINITION_ID }))
    expect(screen.getByRole('link', { name: 'Open the draft' })).toHaveAttribute('href', `/backend/definitions/${DEFINITION_ID}`)
    expect(mockFlash).toHaveBeenCalledWith('Draft workflow created and the suggestion marked as drafted.', 'success')
  })

  it('creates nothing when the confirmation is cancelled', async () => {
    routeDraftFlow()
    mockConfirm.mockResolvedValue(false)
    renderDialog()
    await screen.findByTestId('xray-draft-summary')
    await act(async () => {
      fireEvent.click(screen.getByTestId('xray-draft-create'))
    })
    expect(requests.filter((request) => request.method !== 'GET')).toEqual([])
    expect(screen.queryByTestId('xray-draft-created')).toBeNull()
  })

  it('submits with Cmd/Ctrl+Enter and cancels with Escape', async () => {
    routeDraftFlow()
    const { onClose } = renderDialog()
    await screen.findByTestId('xray-draft-summary')
    const dialog = screen.getByTestId('xray-suggestion-review-dialog')
    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Enter', ctrlKey: true })
    })
    await screen.findByTestId('xray-draft-created')
    expect(mockConfirm).toHaveBeenCalledTimes(1)
    expect(requests.some((request) => request.url.pathname === '/api/workflows/definitions')).toBe(true)

    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' })
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('explains why a suggestion cannot be drafted and offers no create action', async () => {
    respond(() => ({ status: 200, body: { ok: true, persisted: false, suggestionId: SUGGESTION_ID, processKey: 'customers.deal', draftable: false, reason: 'command_forbidden' } }))
    renderDialog()
    expect(await screen.findByTestId('xray-draft-not-draftable')).toHaveTextContent('You are not allowed to run the command the workflow would use.')
    expect(screen.getByTestId('xray-draft-create')).toBeDisabled()
  })
})
