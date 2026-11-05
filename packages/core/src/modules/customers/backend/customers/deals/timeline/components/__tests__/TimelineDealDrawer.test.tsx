/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const mockApiCall = jest.fn()
const mockScopedHeaders: Array<Record<string, string>> = []
const mockUpdateCrud = jest.fn()
const mockSurfaceRecordConflict = jest.fn()
const mockFlash = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useLocale: () => 'en',
  useT: () => (key: string, fallback?: string, params?: Record<string, unknown>) =>
    (fallback ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? '')),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  readApiResultOrThrow: jest.fn().mockResolvedValue(null),
  withScopedApiRequestHeaders: (headers: Record<string, string>, run: () => Promise<unknown>) => {
    mockScopedHeaders.push(headers)
    return run()
  },
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: (...args: unknown[]) => mockUpdateCrud(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: (version: string | null) => (version ? { 'x-om-lock-version': version } : {}),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => mockSurfaceRecordConflict(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('next/link', () => {
  const ReactRuntime = require('react') as typeof import('react')
  return {
    __esModule: true,
    default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      ReactRuntime.createElement('a', { href, ...rest }, children),
  }
})

jest.mock('../../../../../../components/detail/ScheduleActivityDialog', () => ({
  ScheduleActivityDialog: (props: { open: boolean; entityId: string; entityType: string; dealId: string }) =>
    props.open ? (
      <div data-testid="schedule-dialog" data-entity={props.entityId} data-kind={props.entityType} data-deal={props.dealId} />
    ) : null,
}))

jest.mock('../../../../../../components/detail/ConfirmDealLostDialog', () => ({
  ConfirmDealLostDialog: () => null,
}))

jest.mock('../../../../../../components/detail/DealWonPopup', () => ({
  DealWonPopup: () => null,
}))

jest.mock('../../../../../../components/detail/DealLostSummaryDialog', () => ({
  DealLostSummaryDialog: () => null,
}))

jest.mock('../../../pipeline/components/ChangeStageDialog', () => ({
  ChangeStageDialog: (props: { open: boolean; stages: Array<{ id: string }>; onConfirm: (id: string) => void }) =>
    props.open ? (
      <button type="button" onClick={() => props.onConfirm(props.stages[0].id)}>
        confirm-stage
      </button>
    ) : null,
}))

import { TimelineDealDrawer, isDealOverdue, resolveDealStatusKind } from '../TimelineDealDrawer'
import { resetDealDrawerPermissionsCache } from '../useDealDrawerData'

const DEAL_ID = '11111111-1111-4111-8111-111111111111'
const COMPANY_ID = '22222222-2222-4222-8222-222222222222'
const PERSON_ID = '33333333-3333-4333-8333-333333333333'

type DealOverrides = { status?: string; expectedCloseAt?: string | null; updatedAt?: string }

function detailPayload(overrides: DealOverrides = {}) {
  return {
    deal: {
      id: DEAL_ID,
      title: 'LIMS migration',
      status: overrides.status ?? 'open',
      pipelineId: 'pipe-1',
      pipelineStageId: 'stage-1',
      pipelineStage: 'Qualified',
      valueAmount: '91000.00',
      valueCurrency: 'EUR',
      probability: 65,
      expectedCloseAt: overrides.expectedCloseAt === undefined ? '2099-11-02T00:00:00.000Z' : overrides.expectedCloseAt,
      ownerUserId: 'owner-1',
      updatedAt: overrides.updatedAt ?? '2026-10-23T09:12:44.120Z',
    },
    companies: [{ id: COMPANY_ID, label: 'Veridian Labs', kind: 'company' }],
    people: [{ id: PERSON_ID, label: 'Ingrid Malmberg', kind: 'person' }],
    pipelineStages: [
      { id: 'stage-1', label: 'Qualified' },
      { id: 'stage-2', label: 'Proposal' },
    ],
    pipelineName: 'Sales',
    owner: { id: 'owner-1', name: 'Maya Owner', email: 'maya@example.com' },
  }
}

function listPayload(overrides: DealOverrides = {}) {
  return {
    items: [
      {
        id: DEAL_ID,
        updated_at: overrides.updatedAt ?? '2026-10-23T09:12:44.120Z',
        _pipeline: { openActivitiesCount: 2, daysInCurrentStage: 9, isStuck: true, isOverdue: false },
      },
    ],
  }
}

function mockBackend({
  granted = ['customers.*'],
  deal = {},
  detailStatus = 200,
}: { granted?: string[]; deal?: DealOverrides; detailStatus?: number } = {}) {
  mockApiCall.mockImplementation(async (url: string) => {
    if (url === '/api/auth/feature-check') return { ok: true, status: 200, result: { granted } }
    if (url.startsWith(`/api/customers/deals/${DEAL_ID}`)) {
      return detailStatus === 200
        ? { ok: true, status: 200, result: detailPayload(deal) }
        : { ok: false, status: detailStatus, result: null }
    }
    if (url.startsWith('/api/customers/deals?ids=')) return { ok: true, status: 200, result: listPayload(deal) }
    return { ok: false, status: 404, result: null }
  })
}

function renderDrawer(overrides: Partial<React.ComponentProps<typeof TimelineDealDrawer>> = {}) {
  const props = {
    dealId: DEAL_ID,
    onClose: jest.fn(),
    onDealChanged: jest.fn(),
    onRescheduled: jest.fn(),
    canManage: true,
    ...overrides,
  }
  render(<TimelineDealDrawer {...props} />)
  return props
}

async function findDrawer() {
  const drawer = await screen.findByTestId('timeline-deal-drawer')
  await within(drawer).findByTestId('timeline-drawer-open-activities')
  return drawer
}

beforeEach(() => {
  jest.clearAllMocks()
  mockScopedHeaders.length = 0
  resetDealDrawerPermissionsCache()
})

describe('TimelineDealDrawer helpers', () => {
  it('classifies statuses through the deal status helpers', () => {
    expect(resolveDealStatusKind('open')).toBe('open')
    expect(resolveDealStatusKind('won')).toBe('won')
    expect(resolveDealStatusKind('win')).toBe('won')
    expect(resolveDealStatusKind('loose')).toBe('lost')
    expect(resolveDealStatusKind('custom-open')).toBe('open')
    expect(resolveDealStatusKind('closed')).toBe('closed')
    expect(resolveDealStatusKind('Closed')).toBe('closed')
    expect(resolveDealStatusKind('Won')).toBe('won')
  })

  it('flags overdue only for open deals dated before today (UTC)', () => {
    const today = new Date('2026-11-05T10:00:00.000Z')
    expect(isDealOverdue('open', '2026-11-04T00:00:00.000Z', today)).toBe(true)
    expect(isDealOverdue('open', '2026-11-05T00:00:00.000Z', today)).toBe(false)
    expect(isDealOverdue('win', '2026-11-01T00:00:00.000Z', today)).toBe(false)
    expect(isDealOverdue('open', null, today)).toBe(false)
  })
})

describe('TimelineDealDrawer', () => {
  it('renders the close date first, summary, activity and actions for a manager', async () => {
    mockBackend()
    renderDrawer()
    const drawer = await findDrawer()

    expect(within(drawer).getByRole('link', { name: 'LIMS migration' })).toHaveAttribute(
      'href',
      `/backend/customers/deals/${DEAL_ID}`,
    )
    expect(within(drawer).getByRole('link', { name: 'Veridian Labs' })).toHaveAttribute(
      'href',
      `/backend/customers/companies-v2/${COMPANY_ID}`,
    )
    expect(within(drawer).getByRole('link', { name: 'Ingrid Malmberg' })).toHaveAttribute(
      'href',
      `/backend/customers/people-v2/${PERSON_ID}`,
    )
    expect(within(drawer).getByTestId('timeline-drawer-days-in-stage')).toHaveTextContent('9')
    expect(within(drawer).getByTestId('timeline-drawer-open-activities')).toHaveTextContent('2')
    expect(within(drawer).getByText('Stalled')).toBeInTheDocument()
    expect(within(drawer).getByText('Maya Owner')).toBeInTheDocument()

    const stageRow = within(drawer).getByText('Qualified').closest('dd') as HTMLElement
    expect(within(stageRow).getByText('Open')).toBeInTheDocument()
    expect(within(stageRow).getByRole('button', { name: 'Change stage' })).toBeInTheDocument()

    const sections = within(drawer).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    expect(sections).toEqual(['Expected close date', 'Summary', 'Activity', 'Close deal'])
    expect(within(drawer).getByRole('button', { name: 'Change close date' })).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'Mark won' })).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'Mark lost' })).toBeInTheDocument()

    fireEvent.click(within(drawer).getByRole('button', { name: 'Schedule follow-up' }))
    const schedule = screen.getByTestId('schedule-dialog')
    expect(schedule).toHaveAttribute('data-entity', PERSON_ID)
    expect(schedule).toHaveAttribute('data-kind', 'person')
    expect(schedule).toHaveAttribute('data-deal', DEAL_ID)
  })

  it('disables every write while a board reschedule of the deal is in flight', async () => {
    mockBackend()
    renderDrawer({ writesLocked: true })
    const drawer = await findDrawer()
    expect(within(drawer).getByRole('button', { name: 'Change close date' })).toBeDisabled()
    expect(within(drawer).getByRole('button', { name: 'Change stage' })).toBeDisabled()
    expect(within(drawer).getByRole('button', { name: 'Mark won' })).toBeDisabled()
    expect(within(drawer).getByRole('button', { name: 'Mark lost' })).toBeDisabled()
    expect(within(drawer).getByRole('button', { name: 'Schedule follow-up' })).toBeEnabled()
  })

  it('labels a plain closed status as Closed, not Lost', async () => {
    mockBackend({ deal: { status: 'closed' } })
    renderDrawer()
    const drawer = await findDrawer()
    expect(within(drawer).getByText('Closed')).toBeInTheDocument()
    expect(within(drawer).queryByText('Lost')).not.toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: 'Change close date' })).not.toBeInTheDocument()
  })

  it('offers only Schedule follow-up on a closed deal', async () => {
    mockBackend({ deal: { status: 'win' } })
    renderDrawer()
    const drawer = await findDrawer()

    expect(within(drawer).getByText('Won')).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: 'Change close date' })).toBeNull()
    expect(within(drawer).queryByRole('button', { name: 'Change stage' })).toBeNull()
    expect(within(drawer).queryByRole('button', { name: 'Mark won' })).toBeNull()
    expect(within(drawer).queryByRole('button', { name: 'Mark lost' })).toBeNull()
    expect(within(drawer).getByRole('button', { name: 'Schedule follow-up' })).toBeInTheDocument()
  })

  it('renders plain text and hides mutating actions without the matching features', async () => {
    mockBackend({ granted: ['customers.deals.view'] })
    renderDrawer({ canManage: false })
    const drawer = await findDrawer()

    expect(within(drawer).queryByRole('link')).toBeNull()
    expect(within(drawer).getByText('Veridian Labs')).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: 'Change close date' })).toBeNull()
    expect(within(drawer).queryByRole('button', { name: 'Mark won' })).toBeNull()
    expect(within(drawer).queryByRole('button', { name: 'Schedule follow-up' })).toBeNull()
  })

  it('closes silently when the deal is missing or out of scope', async () => {
    mockBackend({ detailStatus: 404 })
    const props = renderDrawer()
    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
    expect(mockFlash).not.toHaveBeenCalled()
  })

  it('reschedules with the lock header, re-reads and reports the new date', async () => {
    mockBackend()
    mockUpdateCrud.mockResolvedValue({ ok: true })
    const props = renderDrawer()
    const drawer = await findDrawer()

    fireEvent.click(within(drawer).getByRole('button', { name: 'Change close date' }))
    const input = (await screen.findByLabelText('New close date')) as HTMLInputElement
    fireEvent.change(input, { target: { value: '2099-12-01' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
    })

    await waitFor(() => expect(props.onRescheduled).toHaveBeenCalledWith({ dealId: DEAL_ID, expectedCloseAt: '2099-12-01' }))
    expect(mockUpdateCrud).toHaveBeenCalledWith('customers/deals', { id: DEAL_ID, expectedCloseAt: '2099-12-01' })
    expect(mockScopedHeaders).toContainEqual({ 'x-om-lock-version': '2026-10-23T09:12:44.120Z' })
    expect(props.onDealChanged).not.toHaveBeenCalled()
    const detailCalls = mockApiCall.mock.calls.filter(([url]) => String(url).startsWith(`/api/customers/deals/${DEAL_ID}`))
    expect(detailCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('routes a 409 to the conflict bar and does not report a reschedule', async () => {
    mockBackend()
    const conflict = Object.assign(new Error('conflict'), { status: 409 })
    mockUpdateCrud.mockRejectedValue(conflict)
    mockSurfaceRecordConflict.mockReturnValue(true)
    const props = renderDrawer()
    const drawer = await findDrawer()

    fireEvent.click(within(drawer).getByRole('button', { name: 'Change close date' }))
    const input = (await screen.findByLabelText('New close date')) as HTMLInputElement
    fireEvent.change(input, { target: { value: '2099-12-01' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    await waitFor(() => expect(mockSurfaceRecordConflict).toHaveBeenCalledWith(conflict, expect.any(Function), expect.any(Object)))
    expect(props.onRescheduled).not.toHaveBeenCalled()
    expect(mockFlash).not.toHaveBeenCalled()
  })

  it('changes the stage with the lock header and notifies the board', async () => {
    mockBackend()
    mockUpdateCrud.mockResolvedValue({ ok: true })
    const props = renderDrawer()
    const drawer = await findDrawer()

    fireEvent.click(within(drawer).getByRole('button', { name: 'Change stage' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'confirm-stage', hidden: true }))
    })

    await waitFor(() => expect(props.onDealChanged).toHaveBeenCalledWith(DEAL_ID))
    expect(mockUpdateCrud).toHaveBeenCalledWith('customers/deals', { id: DEAL_ID, pipelineStageId: 'stage-2' })
    expect(props.onRescheduled).not.toHaveBeenCalled()
  })

  it('re-reads the deal when the board bumps the refresh token', async () => {
    mockBackend()
    const props = {
      dealId: DEAL_ID,
      onClose: jest.fn(),
      onDealChanged: jest.fn(),
      onRescheduled: jest.fn(),
      canManage: true,
    }
    const { rerender } = render(<TimelineDealDrawer {...props} refreshToken={0} />)
    await findDrawer()
    const before = mockApiCall.mock.calls.filter(([url]) => String(url).startsWith(`/api/customers/deals/${DEAL_ID}`)).length
    rerender(<TimelineDealDrawer {...props} refreshToken={1} />)
    await waitFor(() => {
      const after = mockApiCall.mock.calls.filter(([url]) => String(url).startsWith(`/api/customers/deals/${DEAL_ID}`)).length
      expect(after).toBe(before + 1)
    })
  })
})
