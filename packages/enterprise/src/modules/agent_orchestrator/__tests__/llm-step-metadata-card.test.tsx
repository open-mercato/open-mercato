/**
 * @jest-environment jsdom
 */

import { screen, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { LlmStepMetadataCard } from '../components/trace/LlmStepMetadataCard'
import {
  deriveLlmStepRows,
  fidelityBadgeVariant,
  formatCostMicros,
} from '../components/trace/llmStepRows'
import { GEN_AI_ATTRIBUTES, OM_LLM_ATTRIBUTES } from '../lib/trace/genAiAttributes'
import type { SpanView } from '../components/types'

function span(overrides: Partial<SpanView>): SpanView {
  return {
    id: 'span-1',
    externalSpanId: null,
    parentSpanId: null,
    sequence: 0,
    name: 'llm.step',
    kind: 'llm',
    startedAt: '2026-10-26T10:00:00.000Z',
    endedAt: '2026-10-26T10:00:01.000Z',
    durationMs: 1000,
    status: 'ok',
    attributes: null,
    ...overrides,
  }
}

const RECORDED_ATTRIBUTES = {
  [GEN_AI_ATTRIBUTES.providerName]: 'example-provider',
  [GEN_AI_ATTRIBUTES.requestModel]: 'model-large',
  [GEN_AI_ATTRIBUTES.responseModel]: 'model-large-2026',
  [GEN_AI_ATTRIBUTES.requestTemperature]: 0.2,
  [GEN_AI_ATTRIBUTES.requestMaxTokens]: 512,
  [GEN_AI_ATTRIBUTES.usageInputTokens]: 1200,
  [GEN_AI_ATTRIBUTES.usageOutputTokens]: 80,
  [GEN_AI_ATTRIBUTES.usageCacheReadInputTokens]: 1000,
  [GEN_AI_ATTRIBUTES.usageReasoningOutputTokens]: 30,
  [GEN_AI_ATTRIBUTES.responseFinishReasons]: ['tool-calls'],
  [OM_LLM_ATTRIBUTES.costMicros]: 3,
  [OM_LLM_ATTRIBUTES.costCurrency]: 'EUR',
  [OM_LLM_ATTRIBUTES.latencyMs]: 640,
  [OM_LLM_ATTRIBUTES.captureFidelity]: 'exact',
}

const DEFAULTS_ATTRIBUTES = {
  [GEN_AI_ATTRIBUTES.requestModel]: 'model-small',
  [GEN_AI_ATTRIBUTES.responseModel]: 'model-small',
  [OM_LLM_ATTRIBUTES.paramsDefaults]: true,
  [OM_LLM_ATTRIBUTES.captureFidelity]: 'reconstructed',
}

const LEGACY_ATTRIBUTES = { inputTokens: 10, outputTokens: 5, finishReason: 'stop' }

describe('deriveLlmStepRows', () => {
  it('keeps only llm spans ordered by sequence and numbers the steps', () => {
    const rows = deriveLlmStepRows(
      [
        span({ id: 'b', sequence: 3, attributes: DEFAULTS_ATTRIBUTES }),
        span({ id: 'tool', sequence: 1, kind: 'tool' }),
        span({ id: 'a', sequence: 0, attributes: RECORDED_ATTRIBUTES }),
      ],
      'USD',
    )
    expect(rows.map((row) => [row.id, row.step])).toEqual([
      ['a', 1],
      ['b', 2],
    ])
  })

  it('maps recorded gen_ai attributes onto a row', () => {
    const [row] = deriveLlmStepRows([span({ attributes: RECORDED_ATTRIBUTES })], 'USD')
    expect(row).toMatchObject({
      recorded: true,
      provider: 'example-provider',
      requestModel: 'model-large',
      responseModel: 'model-large-2026',
      parameters: [
        { name: 'temperature', value: '0.2' },
        { name: 'max_tokens', value: '512' },
      ],
      usage: { inputTokens: 1200, outputTokens: 80, cachedInputTokens: 1000, reasoningTokens: 30 },
      costMicros: 3,
      currency: 'EUR',
      latencyMs: 640,
      finishReasons: ['tool-calls'],
      fidelity: 'exact',
    })
  })

  it('hides an identical response model and falls back to the run currency and span duration', () => {
    const [row] = deriveLlmStepRows([span({ attributes: DEFAULTS_ATTRIBUTES, durationMs: 250 })], 'PLN')
    expect(row.requestModel).toBe('model-small')
    expect(row.responseModel).toBeNull()
    expect(row.parameters).toEqual([])
    expect(row.currency).toBe('PLN')
    expect(row.latencyMs).toBe(250)
    expect(row.costMicros).toBeNull()
  })

  it('marks legacy spans as not recorded while keeping their tokens', () => {
    const [row] = deriveLlmStepRows([span({ attributes: LEGACY_ATTRIBUTES })], null)
    expect(row.recorded).toBe(false)
    expect(row.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(row.finishReasons).toEqual(['stop'])
    expect(row.fidelity).toBeNull()
    expect(row.currency).toBe('USD')
  })

  it('serializes stop sequences', () => {
    const [row] = deriveLlmStepRows(
      [span({ attributes: { [GEN_AI_ATTRIBUTES.requestStopSequences]: ['END', 'STOP'] } })],
      null,
    )
    expect(row.parameters).toEqual([{ name: 'stop_sequences', value: '["END","STOP"]' }])
  })
})

describe('formatCostMicros', () => {
  it('never rounds a non-zero cost to zero', () => {
    expect(formatCostMicros(1, 'USD', 'en')).toBe('0.000001 USD')
    expect(formatCostMicros(3, 'EUR', 'en')).toBe('0.000003 EUR')
  })

  it('keeps at least two fraction digits', () => {
    expect(formatCostMicros(1_500_000, 'USD', 'en')).toBe('1.50 USD')
    expect(formatCostMicros(0, 'USD', 'en')).toBe('0.00 USD')
  })
})

describe('fidelityBadgeVariant', () => {
  it('maps each fidelity to a status variant', () => {
    expect(fidelityBadgeVariant('exact')).toBe('success')
    expect(fidelityBadgeVariant('reconstructed')).toBe('warning')
    expect(fidelityBadgeVariant('reported')).toBe('info')
  })
})

describe('LlmStepMetadataCard', () => {
  it('renders nothing when the run has no llm spans', () => {
    renderWithProviders(<LlmStepMetadataCard spans={[span({ kind: 'tool' })]} currency="USD" />)
    expect(screen.queryByTestId('llm-step-metadata-card')).toBeNull()
  })

  it('renders one row per llm span with parameters, defaults and legacy notes', () => {
    renderWithProviders(
      <LlmStepMetadataCard
        spans={[
          span({ id: 'a', sequence: 0, attributes: RECORDED_ATTRIBUTES }),
          span({ id: 'b', sequence: 1, attributes: DEFAULTS_ATTRIBUTES }),
          span({ id: 'c', sequence: 2, attributes: LEGACY_ATTRIBUTES }),
        ]}
        currency="USD"
      />,
    )
    expect(screen.getByText('agent_orchestrator.trace.modelCalls')).not.toBeNull()
    const rows = screen.getAllByTestId('llm-step-row')
    expect(rows).toHaveLength(3)
    const recorded = within(rows[0])
    expect(recorded.getByText('model-large → model-large-2026')).not.toBeNull()
    expect(recorded.getByText('temperature=0.2')).not.toBeNull()
    expect(recorded.getByText('agent_orchestrator.trace.fidelity.exact')).not.toBeNull()
    expect(recorded.getByText(/0\.000003 EUR/)).not.toBeNull()
    const defaults = within(rows[1])
    expect(defaults.getByText('agent_orchestrator.trace.providerDefault')).not.toBeNull()
    expect(defaults.getByText('agent_orchestrator.trace.fidelity.reconstructed')).not.toBeNull()
    const legacy = within(rows[2])
    expect(legacy.getByText('agent_orchestrator.trace.notRecorded')).not.toBeNull()
    expect(legacy.getByText('stop')).not.toBeNull()
  })
})
