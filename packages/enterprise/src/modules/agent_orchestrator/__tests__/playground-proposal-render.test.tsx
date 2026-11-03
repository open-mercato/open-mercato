/**
 * @jest-environment jsdom
 *
 * The Playground result panel and the Caseload render the SAME proposal
 * identically (#5980).
 *
 * The Playground has no persisted `ProposalView` — it holds the typed
 * `AgentResult` the run route returned — so it projects one with
 * `mapAdHocProposal`. That mapper is the single derivation both surfaces share,
 * and the bug it fixes was a call site that handed `ProposalCard` the leading
 * option's `actions[]` instead of the envelope: the card read no options off an
 * array and printed "The agent proposed nothing" directly under an 85%
 * recommendation for a proposal that plainly had one.
 *
 * The empty state is honest only while it tracks the option set, so both
 * directions are pinned: a proposal WITH an action never renders it, and a
 * genuinely empty option set still does.
 */

import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import en from '../i18n/en.json'
import { ProposalCard } from '../components/ProposalCard'
import { mapAdHocProposal, mapProposal } from '../components/types'
import { normalizeProposalEnvelope } from '../data/proposalEnvelope'

// The card's only network call is the best-effort agent-icon registry lookup;
// refusing it keeps these assertions about the option set alone.
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: false, status: 403, result: null, response: {}, cacheStatus: null })),
  apiCallOrThrow: jest.fn(async () => ({})),
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

const dict = en as Record<string, string>
const NONE_PROPOSED_TITLE = dict['agent_orchestrator.proposal.options.noneProposed.title']

/** What `POST /agents/:id/run` returns for the issue's "Deal health check" run. */
const RUN_PROPOSAL = {
  options: [
    {
      id: 'negotiation',
      label: 'Stage → Negotiation',
      confidence: 0.85,
      rationale: 'The buyer asked for pricing in writing.',
      actions: [{ type: 'set_stage', payload: { stage: 'negotiation' } }],
    },
    {
      id: 'hold',
      label: 'Hold for legal',
      confidence: 0.4,
      actions: [{ type: 'create_task', payload: { title: 'Legal review' } }],
    },
  ],
  rationale: 'Two viable next steps for this deal.',
}

describe('mapAdHocProposal — the run result projected onto the Caseload shape', () => {
  it('keeps the ENVELOPE as the payload, so the option set survives', () => {
    const view = mapAdHocProposal('deal_health_check', RUN_PROPOSAL)
    expect(Array.isArray(view.payload)).toBe(false)
    expect(normalizeProposalEnvelope(view.payload).options).toHaveLength(2)
    expect(view.confidence).toBe(0.85)
    expect(view.rationale).toBe('Two viable next steps for this deal.')
    expect(view.agentId).toBe('deal_health_check')
  })

  it('derives the same three fields the persisted row does', () => {
    const persisted = mapProposal({
      id: '11111111-1111-4111-8111-111111111111',
      agent_id: 'deal_health_check',
      run_id: '22222222-2222-4222-8222-222222222222',
      payload: RUN_PROPOSAL,
      confidence: 0.85,
      disposition: 'pending',
    })
    const adHoc = mapAdHocProposal('deal_health_check', RUN_PROPOSAL)
    expect(persisted).not.toBeNull()
    expect(adHoc.confidence).toBe(persisted!.confidence)
    expect(adHoc.rationale).toBe(persisted!.rationale)
    expect(normalizeProposalEnvelope(adHoc.payload)).toEqual(normalizeProposalEnvelope(persisted!.payload))
  })

  it('lifts a pre-envelope `{actions, confidence}` result to one option rather than none', () => {
    const view = mapAdHocProposal('legacy_agent', {
      actions: [{ type: 'set_stage', payload: { stage: 'negotiation' } }],
      confidence: 0.7,
      rationale: 'Only one sensible move.',
    })
    expect(normalizeProposalEnvelope(view.payload).options).toHaveLength(1)
    expect(view.confidence).toBe(0.7)
  })

  it('reports an empty option set as empty — the one case that IS `none_proposed`', () => {
    const view = mapAdHocProposal('deal_health_check', { options: [], rationale: 'Nothing to do here.' })
    expect(normalizeProposalEnvelope(view.payload).options).toHaveLength(0)
    expect(view.confidence).toBeNull()
  })
})

describe('ProposalCard (playground, read-only) — the empty state is honest', () => {
  it('renders the proposed options and NOT "the agent proposed nothing"', () => {
    const { container } = renderWithProviders(
      <ProposalCard adHoc={mapAdHocProposal('deal_health_check', RUN_PROPOSAL)} />,
      { dict },
    )
    expect(screen.queryByText(NONE_PROPOSED_TITLE)).toBeNull()

    const rendered = Array.from(container.querySelectorAll('[data-proposal-option]')).map((node) =>
      node.getAttribute('data-proposal-option'),
    )
    expect(rendered).toEqual(['negotiation', 'hold'])
    expect(screen.getByText('Stage → Negotiation')).toBeTruthy()
    expect(screen.getByText('85% confidence')).toBeTruthy()

    // The heading count is the option count, not zero.
    const heading = screen.getByText(dict['agent_orchestrator.proposal.options.heading'])
    expect(heading.parentElement?.textContent).toContain('2')
  })

  it('still renders the empty state when the agent genuinely proposed nothing', () => {
    const { container } = renderWithProviders(
      <ProposalCard adHoc={mapAdHocProposal('deal_health_check', { options: [] })} />,
      { dict },
    )
    expect(screen.getByText(NONE_PROPOSED_TITLE)).toBeTruthy()
    expect(container.querySelectorAll('[data-proposal-option]')).toHaveLength(0)
  })
})

describe('playground source invariants', () => {
  const page = readFileSync(join(__dirname, '..', 'backend', 'playground', 'page.tsx'), 'utf8')

  it('projects the run result through the shared mapper', () => {
    expect(page).toContain('mapAdHocProposal(agentId, result.proposal)')
  })

  it('never hands the card one option’s actions as the payload', () => {
    expect(page).not.toContain('readProposalActions')
  })
})
