/**
 * @jest-environment jsdom
 *
 * The Caseload renders the OPTION SET, not a verdict (spec
 * `2026-08-11-agent-taxonomy.md`, Phase 4 step 11).
 *
 * Four facts are load-bearing and each has a test below:
 * - the options render RANKED, each with its own rationale and confidence;
 * - selecting one and approving disposes exactly THAT option — nothing is
 *   derived on the operator's behalf, which is the placeholder Phase 4 removes;
 * - `near_tie` is EXPLAINED where it applies, because silence reads as "the
 *   threshold simply was not met";
 * - `none_proposed` presents honestly — its own badge and its own empty state,
 *   never the approved badge.
 */

import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import en from '../i18n/en.json'
import { ProposalOptionList } from '../components/ProposalOptionList'
import { proposalCaseStatus, PROPOSAL_CASE_STATUS_VARIANT } from '../components/proposalCaseStatus'
import { readProposalActions } from '../data/proposalEnvelope'
import ProposalDetailPage from '../backend/caseload/[proposalId]/page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, status: 200, result: { items: [] }, response: {}, cacheStatus: null })),
  apiCallOrThrow: jest.fn(async () => ({})),
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))

const dict = en as Record<string, string>
const PROPOSAL_ID = '11111111-1111-4111-8111-111111111111'
const RUN_ID = '22222222-2222-4222-8222-222222222222'

const OPTIONS = [
  {
    id: 'advance',
    label: 'Advance to won',
    confidence: 0.62,
    rationale: 'Buyer confirmed the budget in writing.',
    actions: [{ type: 'set_stage', payload: { stage: 'won' } }],
  },
  {
    id: 'hold',
    label: 'Hold for legal',
    confidence: 0.58,
    rationale: 'One contract clause is still unresolved.',
    actions: [{ type: 'create_task', payload: { title: 'Legal review' } }],
  },
  {
    id: 'drop',
    label: 'Drop the deal',
    confidence: 0.1,
    actions: [{ type: 'set_stage', payload: { stage: 'lost' } }],
  },
]

// Deliberately NOT in ranked order on the wire: ranking is the UI's job, and a
// test fed pre-sorted options would pass even if the ranking were dropped.
const PAYLOAD = { options: [OPTIONS[1], OPTIONS[2], OPTIONS[0]], rationale: 'Three viable next steps.' }

function proposalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROPOSAL_ID,
    agent_id: 'deal_advisor',
    run_id: RUN_ID,
    payload: PAYLOAD,
    confidence: 0.62,
    disposition: 'pending',
    guard_results: [],
    created_at: '2026-08-11T09:00:00.000Z',
    updated_at: '2026-08-11T09:00:00.000Z',
    ...overrides,
  }
}

function mockDetailApi(row: Record<string, unknown>) {
  ;(readApiResultOrThrow as jest.Mock).mockImplementation(async (url: string) => {
    if (url.startsWith('/api/agent_orchestrator/proposals')) return { items: [row] }
    if (url.startsWith('/api/agent_orchestrator/runs')) return { items: [{ id: RUN_ID, agent_id: 'deal_advisor' }] }
    return { items: [] }
  })
}

function renderList(props: Partial<React.ComponentProps<typeof ProposalOptionList>> = {}) {
  return renderWithProviders(<ProposalOptionList payload={PAYLOAD} {...props} />, { dict })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(apiCallOrThrow as jest.Mock).mockResolvedValue({})
  ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({ items: [] })
})

describe('ProposalOptionList — the option set, ranked', () => {
  it('renders every option ordered by confidence, each with its own rationale and confidence', () => {
    const { container } = renderList()
    const rendered = Array.from(container.querySelectorAll('[data-proposal-option]')).map((node) =>
      node.getAttribute('data-proposal-option'),
    )
    expect(rendered).toEqual(['advance', 'hold', 'drop'])

    const advance = container.querySelector('[data-proposal-option="advance"]') as HTMLElement
    expect(within(advance).getByText('#1')).toBeTruthy()
    expect(within(advance).getByText('Advance to won')).toBeTruthy()
    expect(within(advance).getByText('62% confidence')).toBeTruthy()
    expect(within(advance).getByText('Buyer confirmed the budget in writing.')).toBeTruthy()

    const hold = container.querySelector('[data-proposal-option="hold"]') as HTMLElement
    expect(within(hold).getByText('#2')).toBeTruthy()
    expect(within(hold).getByText('58% confidence')).toBeTruthy()
    expect(within(hold).getByText('One contract clause is still unresolved.')).toBeTruthy()

    // An option that declared no confidence says so rather than showing 0%.
    const { container: noConfidence } = renderWithProviders(
      <ProposalOptionList payload={{ options: [{ id: 'a', label: 'A', actions: [{ type: 'ping', payload: {} }] }] }} />,
      { dict },
    )
    expect(within(noConfidence).getByText('No confidence given')).toBeTruthy()
  })

  it('exposes ONE selection control — a radiogroup with keyboard navigation', () => {
    const onSelect = jest.fn()
    const { container } = renderList({ onSelect, selectedOptionId: 'advance' })
    expect(container.querySelectorAll('[role="radiogroup"]').length).toBe(1)
    expect(container.querySelectorAll('[role="radio"]').length).toBe(3)

    const advance = container.querySelector('[data-proposal-option="advance"]') as HTMLElement
    expect(advance.getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(advance, { key: 'ArrowDown' })
    expect(onSelect).toHaveBeenCalledWith('hold')
    fireEvent.keyDown(advance, { key: 'End' })
    expect(onSelect).toHaveBeenCalledWith('drop')
  })

  it('explains near_tie where it applies, and stays silent where it does not', () => {
    const explanation = dict['agent_orchestrator.proposal.options.nearTie']
    const blocked = renderList({ autoDispositionBlock: 'near_tie' })
    expect(blocked.getByText(explanation)).toBeTruthy()
    blocked.unmount()

    const clear = renderList({ autoDispositionBlock: null })
    expect(clear.queryByText(explanation)).toBeNull()
  })

  it('presents an empty option set as "nothing proposed", never as a selectable row', () => {
    const { container, getByText } = renderWithProviders(<ProposalOptionList payload={{ options: [] }} onSelect={jest.fn()} />, { dict })
    expect(getByText(dict['agent_orchestrator.proposal.options.noneProposed.title'])).toBeTruthy()
    expect(container.querySelectorAll('[role="radio"]').length).toBe(0)
    expect(container.querySelectorAll('[data-proposal-option]').length).toBe(0)
  })
})

describe('proposalCaseStatus — none_proposed is not an approval', () => {
  it('maps every stored disposition to its own status, defaulting to unknown', () => {
    expect(proposalCaseStatus('pending')).toBe('actionRequired')
    expect(proposalCaseStatus('approved')).toBe('approved')
    expect(proposalCaseStatus('edited')).toBe('approved')
    expect(proposalCaseStatus('auto_approved')).toBe('autoApproved')
    expect(proposalCaseStatus('rejected')).toBe('rejected')
    expect(proposalCaseStatus('none_proposed')).toBe('noneProposed')
    expect(proposalCaseStatus('something_new')).toBe('unknown')
  })

  it('gives none_proposed a neutral badge, not the approved one', () => {
    expect(PROPOSAL_CASE_STATUS_VARIANT.noneProposed).toBe('neutral')
    expect(PROPOSAL_CASE_STATUS_VARIANT.noneProposed).not.toBe(PROPOSAL_CASE_STATUS_VARIANT.approved)
    expect(PROPOSAL_CASE_STATUS_VARIANT.unknown).toBe('neutral')
  })
})

describe('Caseload proposal detail — selecting and approving one option', () => {
  it('sends ONLY the chosen option id, and that id resolves to only that option\'s actions', async () => {
    mockDetailApi(proposalRow())
    const { container } = renderWithProviders(<ProposalDetailPage params={{ proposalId: PROPOSAL_ID }} />, { dict })
    await screen.findByText('Advance to won')

    // Three real alternatives, so nothing is preselected and approve is inert:
    // the endpoint requires an option and picking the leader for the operator is
    // precisely the placeholder this phase removes.
    const approve = screen.getByRole('button', { name: dict['agent_orchestrator.proposal.actions.approve'] })
    expect((approve as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(container.querySelector('[data-proposal-option="hold"]') as HTMLElement)
    await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(approve)

    await waitFor(() => expect(apiCallOrThrow as jest.Mock).toHaveBeenCalled())
    const [url, init] = (apiCallOrThrow as jest.Mock).mock.calls[0]
    expect(url).toContain(`/proposals/${PROPOSAL_ID}/dispose`)
    const body = JSON.parse((init as { body: string }).body)
    expect(body).toMatchObject({ disposition: 'approved', selectedOptionId: 'hold' })
    // No payload override rides along on a plain approve — the agent's own plan runs.
    expect(body.payload).toBeUndefined()

    // And that id names exactly one plan: the hold option's, never the leader's.
    expect(readProposalActions(PAYLOAD, body.selectedOptionId)).toEqual(OPTIONS[1].actions)
    expect(readProposalActions(PAYLOAD, body.selectedOptionId)).not.toEqual(OPTIONS[0].actions)
  })

  it('preselects the sole option when there is no choice to make', async () => {
    mockDetailApi(proposalRow({ payload: { options: [OPTIONS[0]] } }))
    renderWithProviders(<ProposalDetailPage params={{ proposalId: PROPOSAL_ID }} />, { dict })
    const approve = await screen.findByRole('button', { name: dict['agent_orchestrator.proposal.actions.approve'] })
    expect((approve as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(approve)
    await waitFor(() => expect(apiCallOrThrow as jest.Mock).toHaveBeenCalled())
    const body = JSON.parse((apiCallOrThrow as jest.Mock).mock.calls[0][1].body)
    expect(body.selectedOptionId).toBe('advance')
  })

  it('renders a none_proposed proposal honestly — its own badge, no dispose buttons', async () => {
    mockDetailApi(proposalRow({ disposition: 'none_proposed', payload: { options: [] }, confidence: null }))
    renderWithProviders(<ProposalDetailPage params={{ proposalId: PROPOSAL_ID }} />, { dict })

    expect(await screen.findByText(dict['agent_orchestrator.caseload.status.noneProposed'])).toBeTruthy()
    expect(screen.queryByText(dict['agent_orchestrator.caseload.status.approved'])).toBeNull()
    expect(screen.getByText(dict['agent_orchestrator.proposal.options.noneProposed.title'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: dict['agent_orchestrator.proposal.actions.approve'] })).toBeNull()
    expect(screen.queryByRole('button', { name: dict['agent_orchestrator.proposal.actions.reject'] })).toBeNull()
  })

  it('replays the option a disposed proposal actually ran', async () => {
    mockDetailApi(proposalRow({ disposition: 'approved', selected_option_id: 'drop' }))
    const { container } = renderWithProviders(<ProposalDetailPage params={{ proposalId: PROPOSAL_ID }} />, { dict })
    await screen.findByText('Drop the deal')
    const drop = container.querySelector('[data-proposal-option="drop"]') as HTMLElement
    expect(drop.getAttribute('data-selected')).toBe('true')
    const advance = container.querySelector('[data-proposal-option="advance"]') as HTMLElement
    expect(advance.getAttribute('data-selected')).toBe('false')
  })
})

describe('Caseload queue — no dispose path derives an option for the operator', () => {
  const source = readFileSync(join(__dirname, '..', 'backend/caseload/page.tsx'), 'utf8')
  const detailSource = readFileSync(
    join(__dirname, '..', 'backend/caseload/[proposalId]/page.tsx'),
    'utf8',
  )

  it('no longer reaches for the leading option when building a verdict', () => {
    expect(source).not.toContain('leadProposalOption')
    expect(detailSource).not.toContain('leadProposalOption')
  })

  it('sends the operator-chosen option and offers a default only when there is no choice', () => {
    expect(source).toContain('selectedOptionId: target.optionId')
    expect(source).toMatch(/defaultOptionId: proposal\.selectedOptionId \?\? \(options\.length === 1 \? options\[0\]\.id : null\)/)
    expect(source).toMatch(/optionChoices\.get\(row\.id\) \?\? row\.defaultOptionId/)
  })

  it('renders the ranked option list in the decision pane', () => {
    expect(source).toContain('<ProposalOptionList')
    expect(source).toContain('autoDispositionBlock={row.autoDispositionBlock}')
  })

  it('keeps none_proposed visible in the "all" segment rather than hidden', () => {
    expect(source).toMatch(/all: 'pending,approved,auto_approved,edited,rejected,none_proposed'/)
    expect(source).toContain("noneProposed: countOf('none_proposed')")
  })
})
