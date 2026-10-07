/**
 * One-line node config summaries (fidelity gap #6).
 *
 * The design's nodes are not bigger than ours — measured, ours are wider. They
 * are more informative, because the body line states the step's CONFIGURATION
 * rather than clamping two lines of the author's prose. These tests pin what
 * each node type states, and that a node with nothing configured still falls
 * back to its description rather than going blank.
 */

import { describe, test, expect } from '@jest/globals'
import {
  buildNodeConfigSummary,
  formatNodeConfigSummary,
} from '../node-config-summary'

const translations: Record<string, string> = {
  'workflows.nodeSummary.alwaysAsk': 'always ask',
  'workflows.nodeSummary.assigned': 'assigned',
  'workflows.nodeSummary.autoApproveThreshold': 'auto ≥ {threshold}',
  'workflows.nodeSummary.bound': 'bound: {count}',
  'workflows.nodeSummary.decisions': '{count} decisions',
  'workflows.nodeSummary.retries': 'retries {count}×',
  'workflows.nodeSummary.role': 'role: {roles}',
  'workflows.nodeSummary.until': 'until {value}',
}

function translate(
  key: string,
  fallbackOrParams?: string | Record<string, string | number>,
  params?: Record<string, string | number>,
): string {
  const resolvedParams = typeof fallbackOrParams === 'string' ? params : fallbackOrParams
  return (translations[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = resolvedParams?.[name]
    return value === undefined ? match : String(value)
  })
}

function summaryOf(nodeType: string, data: Record<string, unknown>): string {
  return formatNodeConfigSummary(buildNodeConfigSummary(nodeType, data as never), translate)
}

describe('automated steps state their command and retry policy', () => {
  test('renders the analysis example verbatim', () => {
    expect(
      summaryOf('automated', {
        activities: [{ activityType: 'UPDATE_ENTITY', config: { commandId: 'customers.deals.update' } }],
        retryPolicy: { maxAttempts: 3 },
      }),
    ).toBe('customers.deals.update · retries 3×')
  })

  test('renders the command id monospaced and the retry count plainly', () => {
    const segments = buildNodeConfigSummary('automated', {
      activities: [{ activityType: 'UPDATE_ENTITY', config: { commandId: 'customers.deals.update' } }],
      retryPolicy: { maxAttempts: 3 },
    } as never)
    expect(segments[0]).toEqual({ text: 'customers.deals.update', mono: true })
    expect(segments[1]).toEqual({
      translationKey: 'workflows.nodeSummary.retries',
      translationParams: { count: 3 },
    })
  })

  test('omits a retry policy that retries nothing', () => {
    expect(
      summaryOf('automated', {
        activities: [{ activityType: 'UPDATE_ENTITY', config: { commandId: 'a.b' } }],
        retryPolicy: { maxAttempts: 1 },
      }),
    ).toBe('a.b')
  })

  test('falls back to the function or event id, then to the activity type', () => {
    expect(
      summaryOf('automated', {
        activities: [{ activityType: 'EXECUTE_FUNCTION', config: { functionName: 'scoreLead' } }],
      }),
    ).toBe('scoreLead')
    expect(
      summaryOf('automated', {
        activities: [{ activityType: 'EMIT_EVENT', config: { eventId: 'sales.order.approved' } }],
      }),
    ).toBe('sales.order.approved')
    expect(summaryOf('automated', { activities: [{ activityType: 'CALL_WEBHOOK', config: {} }] })).toBe(
      'CALL_WEBHOOK',
    )
  })
})

describe('agent steps state the agent and the threshold', () => {
  test('names the agent and the auto-approve threshold', () => {
    expect(
      summaryOf('invokeAgent', {
        agentId: 'deal_enricher',
        activities: [
          { activityType: 'INVOKE_AGENT', config: { agentId: 'deal_enricher', onResult: { autoApproveThreshold: 0.8 } } },
        ],
      }),
    ).toBe('deal_enricher · auto ≥ 0.8')
  })

  test('says so when every proposal goes to a human', () => {
    expect(
      summaryOf('invokeAgent', {
        activities: [{ activityType: 'INVOKE_AGENT', config: { agentId: 'risk', onResult: { alwaysAsk: true } } }],
      }),
    ).toBe('risk · always ask')
  })
})

describe('the other step types', () => {
  test('a user task states its queue, bindings and decision count', () => {
    expect(
      summaryOf('userTask', {
        assignedToRoles: ['Sales Rep'],
        entityBindings: [{ entityType: 'customers:deal' }],
        decisions: [{ id: 'a' }, { id: 'b' }],
      }),
    ).toBe('role: Sales Rep · bound: 1 · 2 decisions')
  })

  test('a wait step states what it waits for', () => {
    expect(summaryOf('waitForSignal', { signalConfig: { signalName: 'payment.confirmed' } })).toBe(
      'payment.confirmed',
    )
    expect(summaryOf('waitForTimer', { config: { duration: '2d' } })).toBe('2d')
    expect(summaryOf('waitForTimer', { config: { until: '2026-08-01' } })).toBe('until 2026-08-01')
  })

  test('a sub-workflow names the workflow it invokes', () => {
    expect(summaryOf('subWorkflow', { subWorkflowId: 'kyc_check' })).toBe('kyc_check')
  })
})

describe('nothing configured means nothing claimed', () => {
  test('an unconfigured node produces no summary, so the card keeps its description', () => {
    expect(buildNodeConfigSummary('automated', {})).toEqual([])
    expect(buildNodeConfigSummary('userTask', {})).toEqual([])
    expect(buildNodeConfigSummary('waitForTimer', {})).toEqual([])
  })

  test('a node type with no summary rule is left alone', () => {
    expect(buildNodeConfigSummary('start', { label: 'Start' })).toEqual([])
    expect(buildNodeConfigSummary('ifElse', {})).toEqual([])
  })

  test('missing data never throws', () => {
    expect(buildNodeConfigSummary('automated', null)).toEqual([])
    expect(buildNodeConfigSummary('invokeAgent', undefined)).toEqual([])
  })
})
