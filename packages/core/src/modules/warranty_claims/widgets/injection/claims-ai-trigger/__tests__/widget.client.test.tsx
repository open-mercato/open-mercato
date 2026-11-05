/**
 * @jest-environment jsdom
 *
 * Claims list AiChat injection widget unit tests.
 *
 * The widget itself is a trigger button that opens a Dialog embedding
 * `<AiChat>`. Unit-test only the trigger + selection-pill computation;
 * the sheet-open + chat behavior follows the customers ai-assistant-trigger
 * pattern covered by TC-AI-INJECT-009-backend-inject.spec.ts.
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import ClaimsAiTriggerWidget, {
  WARRANTY_CLAIMS_AI_INJECT_AGENT_ID,
  computeWarrantyClaimsAiInjectPageContext,
} from '../widget.client'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) => {
    if (!fallback) return _key
    if (!vars) return fallback
    return fallback.replace(/\{(\w+)\}/g, (_m, name) =>
      name in vars ? String((vars as Record<string, unknown>)[name]) : `{${name}}`,
    )
  },
}))

jest.mock('@open-mercato/ui/ai/AiChat', () => ({
  AiChat: () => <div data-testid="mock-ai-chat" />,
}))

describe('warranty_claims ClaimsAiTriggerWidget', () => {
  it('exposes the claim detail page agent id', () => {
    expect(WARRANTY_CLAIMS_AI_INJECT_AGENT_ID).toBe('warranty_claims.claims_assistant')
  })

  it('renders the trigger button with the injection test hook', () => {
    render(<ClaimsAiTriggerWidget context={{ selectedCount: 0, totalMatching: 0 }} />)
    const trigger = screen.getByRole('button', { name: /open ai assistant for warranty claims/i })
    expect(trigger).toBeTruthy()
    expect(trigger.getAttribute('data-ai-warranty-claims-inject-trigger')).toBe('')
  })

  it('degrades gracefully when host context is absent', () => {
    render(<ClaimsAiTriggerWidget />)
    expect(
      screen.getByRole('button', { name: /open ai assistant for warranty claims/i }),
    ).toBeTruthy()
  })
})

describe('warranty_claims computeWarrantyClaimsAiInjectPageContext', () => {
  it('emits an empty selection pageContext when no rows are selected', () => {
    const ctx = computeWarrantyClaimsAiInjectPageContext({
      selectedCount: 0,
      totalMatching: 42,
    })
    expect(ctx.view).toBe('warranty_claims.claims.list')
    expect(ctx.recordType).toBeNull()
    expect(ctx.recordId).toBeNull()
    expect(ctx.extra).toEqual({ selectedCount: 0, totalMatching: 42 })
  })

  it('serializes selected row ids as a comma-separated recordId', () => {
    const ctx = computeWarrantyClaimsAiInjectPageContext({
      selectedRowIds: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
      totalMatching: 10,
    })
    expect(ctx.recordId).toBe('11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222')
    expect(ctx.extra.selectedCount).toBe(2)
    expect(ctx.extra.totalMatching).toBe(10)
  })

  it('falls back to selectedCount when the host omits per-id data', () => {
    const ctx = computeWarrantyClaimsAiInjectPageContext({
      selectedCount: 3,
      totalMatching: 30,
    })
    expect(ctx.recordId).toBeNull()
    expect(ctx.extra.selectedCount).toBe(3)
    expect(ctx.extra.totalMatching).toBe(30)
  })

  it('accepts string totalMatching and coerces to number', () => {
    const ctx = computeWarrantyClaimsAiInjectPageContext({
      selectedCount: 0,
      totalMatching: '17' as unknown as number,
    })
    expect(ctx.extra.totalMatching).toBe(17)
  })
})
