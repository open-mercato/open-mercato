/**
 * @jest-environment jsdom
 *
 * Step 5.15 — Customers Deal detail AiChat injection widget unit tests.
 *
 * Covers:
 *  - Trigger renders for a deal-scoped injection context (dealId / status /
 *    pipelineStageId hydrated from host props).
 *  - `computeCustomersAiDealDetailPageContext` produces the spec §10.1
 *    shape and handles the two host-context shapes (flat `context.dealId`
 *    vs. nested `data.deal.id`).
 *  - The widget returns `null` when no deal id is resolvable, keeping the
 *    page visually clean rather than surfacing a useless button.
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import AiDealDetailTriggerWidget, {
  computeCustomersAiDealDetailPageContext,
} from '../widget.client'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/ui/ai/AiChat', () => ({
  AiChat: () => <div data-testid="mock-ai-chat" />,
}))

describe('customers AiDealDetailTriggerWidget', () => {
  it('renders the trigger with deal id hydrated from flat context', () => {
    render(
      <AiDealDetailTriggerWidget
        context={{
          dealId: '11111111-1111-1111-1111-111111111111',
          stage: 'open',
          pipelineStageId: '22222222-2222-2222-2222-222222222222',
        }}
      />,
    )
    const trigger = screen.getByRole('button', { name: /open ai assistant for this deal/i })
    expect(trigger).toBeTruthy()
    expect(trigger.getAttribute('data-ai-customers-deal-trigger')).toBe('')
    expect(trigger.getAttribute('data-ai-customers-deal-id')).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('returns null when no deal id can be resolved', () => {
    const { container } = render(<AiDealDetailTriggerWidget context={{}} />)
    expect(container.querySelector('[data-ai-customers-deal-trigger]')).toBeNull()
  })
})

describe('customers computeCustomersAiDealDetailPageContext (Step 5.15)', () => {
  it('builds the spec §10.1 shape from a flat context', () => {
    const ctx = computeCustomersAiDealDetailPageContext({
      dealId: 'deal-1',
      stage: 'won',
      pipelineStageId: 'stage-3',
    })
    expect(ctx).toEqual({
      view: 'customers.deal.detail',
      recordType: 'deal',
      recordId: 'deal-1',
      extra: { stage: 'won', pipelineStageId: 'stage-3' },
    })
  })

  it('falls back to nested `data.deal.*` fields from the host page payload', () => {
    const ctx = computeCustomersAiDealDetailPageContext(
      undefined,
      {
        deal: {
          id: 'deal-2',
          status: 'open',
          pipelineStage: 'Qualified',
          pipelineStageId: 'stage-7',
        },
      },
    )
    expect(ctx).toEqual({
      view: 'customers.deal.detail',
      recordType: 'deal',
      recordId: 'deal-2',
      extra: { stage: 'open', pipelineStageId: 'stage-7' },
    })
  })

  it('prefers the flat dealId when both sources supply an id', () => {
    const ctx = computeCustomersAiDealDetailPageContext(
      { dealId: 'flat-wins' },
      { deal: { id: 'nested-loses' } },
    )
    expect(ctx?.recordId).toBe('flat-wins')
  })

  it('returns null when no deal id is available', () => {
    expect(computeCustomersAiDealDetailPageContext({}, {})).toBeNull()
  })
})
