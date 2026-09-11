/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Node, Edge } from '@xyflow/react'
import {
  extractContextRefs,
  findUnresolvedRefs,
  collectUnresolvedContextRefWarnings,
  type ContextRef,
} from '../expression-refs'
import { computeContextLedger, type ContextLedger, type LedgerWorkflowDefinition } from '../context-ledger'
import { collectValidationIssues } from '../collect-validation-issues'

const stepRef = (refs: ContextRef[], path: string): ContextRef | undefined =>
  refs.find((ref) => ref.path === path)

describe('expression-refs purity boundary', () => {
  test('only value-imports the pure interpolation-pipeline parser', () => {
    const source = readFileSync(join(__dirname, '..', 'expression-refs.ts'), 'utf8')
    const statements = source.match(/^import\b[\s\S]*?from\s+['"][^'"]+['"]/gm) ?? []
    const valueSpecifiers = statements
      .filter((statement) => !/^import\s+type\b/.test(statement))
      .map((statement) => statement.match(/from\s+['"]([^'"]+)['"]/)?.[1] ?? statement)
    expect(valueSpecifiers).toEqual(['./interpolation-pipeline'])
  })
})

describe('extractContextRefs', () => {
  test('extracts context refs from step activity configs recursively, skipping engine tokens', () => {
    const refs = extractContextRefs({
      steps: [
        {
          stepId: 'notify',
          stepType: 'AUTOMATED',
          activities: [
            {
              activityId: 'send',
              activityType: 'SEND_EMAIL',
              config: {
                to: '{{context.customer.email}}',
                subject: 'Order {{context.order.id}} for {{context.customer.name}}',
                body: 'Instance {{workflow.instanceId}} at {{now}} via {{env.APP_URL}}',
                attachments: [{ url: '{{context.invoice.url}}' }],
                bare: '{{orderId}}',
              },
            },
          ],
        },
      ],
    })

    expect(refs.map((ref) => ref.path).sort()).toEqual([
      'customer.email',
      'customer.name',
      'invoice.url',
      'order.id',
      'orderId',
    ])
    expect(stepRef(refs, 'customer.email')).toMatchObject({
      location: { stepIndex: 0, activityIndex: 0, field: 'config.to' },
      scope: { kind: 'step', stepId: 'notify' },
    })
    expect(stepRef(refs, 'invoice.url')).toMatchObject({
      location: { stepIndex: 0, activityIndex: 0, field: 'config.attachments.0.url' },
    })
  })

  test('extracts transition activity refs with transition scope', () => {
    const refs = extractContextRefs({
      transitions: [
        {
          transitionId: 'review-to-approve',
          fromStepId: 'review',
          toStepId: 'approve',
          activities: [
            {
              activityId: 'log',
              activityType: 'EMIT_EVENT',
              config: { payload: { decision: '{{context.decision}}' } },
            },
          ],
        },
      ],
    })

    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      path: 'decision',
      location: { transitionIndex: 0, activityIndex: 0, field: 'config.payload.decision' },
      scope: { kind: 'transition', fromStepId: 'review', toStepId: 'approve' },
    })
  })

  test('extracts sub-workflow inputMapping values as bare context paths and ignores outputMapping', () => {
    const refs = extractContextRefs({
      steps: [
        {
          stepId: 'child',
          stepType: 'SUB_WORKFLOW',
          subWorkflowConfig: {
            subWorkflowId: 'child-flow',
            inputMapping: { orderId: 'context.order.id', email: 'customer.email' },
            outputMapping: { result: 'childOnly.path' },
          },
        },
      ],
    })

    expect(refs.map((ref) => ref.path).sort()).toEqual(['customer.email', 'order.id'])
    expect(stepRef(refs, 'order.id')).toMatchObject({
      location: { stepIndex: 0, field: 'subWorkflowConfig.inputMapping.orderId' },
      scope: { kind: 'step', stepId: 'child' },
    })
  })

  test('piped tokens contribute their base path only, with the transform tail stripped', () => {
    const refs = extractContextRefs({
      steps: [
        {
          stepId: 'notify',
          stepType: 'AUTOMATED',
          activities: [
            {
              activityId: 'send',
              activityType: 'SEND_EMAIL',
              config: {
                closeDate: "{{context.deal.closeDate | date('yyyy-MM-dd')}}",
                greeting: "Hello {{customer.name | title | default('there')}}!",
                engine: "{{workflow.instanceId | upper}} at {{now | date('yyyy')}} via {{env.APP_URL | lower}}",
              },
            },
          ],
        },
      ],
    })

    expect(refs.map((ref) => ref.path).sort()).toEqual(['customer.name', 'deal.closeDate'])
  })

  test('tokens with an unparseable transform tail are skipped, not misread as literal paths', () => {
    const refs = extractContextRefs({
      steps: [
        {
          stepId: 'notify',
          stepType: 'AUTOMATED',
          activities: [
            {
              activityId: 'send',
              activityType: 'SEND_EMAIL',
              config: { broken: "{{customer.name | concat('open}}" },
            },
          ],
        },
      ],
    })

    expect(refs).toEqual([])
  })

  test('extracts only template refs from trigger sourceExpressions, not bare payload paths', () => {
    const refs = extractContextRefs({
      triggers: [
        {
          triggerId: 'on-order',
          config: {
            contextMapping: [
              { targetKey: 'orderId', sourceExpression: 'entity.id' },
              { targetKey: 'broken', sourceExpression: '{{context.somewhere}}' },
            ],
          },
        },
      ],
    })

    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      path: 'somewhere',
      location: { triggerIndex: 0, field: 'config.contextMapping.1.sourceExpression' },
      scope: { kind: 'trigger', triggerId: 'on-order' },
    })
  })
})

describe('findUnresolvedRefs', () => {
  const ledger: ContextLedger = {
    steps: {
      review: {
        entries: [
          { path: 'orderId', type: 'text', presence: 'always', source: { kind: 'contextSchema', label: 'contextSchema.input' } },
        ],
      },
      approve: {
        entries: [
          { path: 'orderId', type: 'text', presence: 'always', source: { kind: 'contextSchema', label: 'contextSchema.input' } },
          { path: 'customer', type: 'object', presence: 'always', source: { kind: 'activity', label: 'activity:load' } },
          { path: 'decision.reason', type: 'text', presence: 'maybe', source: { kind: 'userTask', stepId: 'review', label: 'userTask:review' } },
          { path: 'amount', type: 'number', presence: 'always', source: { kind: 'contextSchema', label: 'contextSchema.input' } },
        ],
      },
    },
  }

  const ref = (path: string, scope: ContextRef['scope']): ContextRef => ({
    path,
    location: { field: 'config.value' },
    scope,
  })

  test('step-scoped refs check against that step incoming view', () => {
    const unresolved = findUnresolvedRefs(
      [ref('orderId', { kind: 'step', stepId: 'review' }), ref('customer', { kind: 'step', stepId: 'review' })],
      ledger,
    )
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0]).toMatchObject({ ref: { path: 'customer' }, stepId: 'review' })
  })

  test('transition-scoped refs check against the TARGET step incoming view', () => {
    const unresolved = findUnresolvedRefs(
      [
        ref('customer.name', { kind: 'transition', fromStepId: 'review', toStepId: 'approve' }),
        ref('missing.path', { kind: 'transition', fromStepId: 'review', toStepId: 'approve' }),
      ],
      ledger,
    )
    expect(unresolved.map((entry) => entry.ref.path)).toEqual(['missing.path'])
    expect(unresolved[0].stepId).toBe('approve')
  })

  test('prefix matching: object/unknown entries resolve deeper refs, scalar entries do not', () => {
    const unresolved = findUnresolvedRefs(
      [
        ref('customer.address.city', { kind: 'step', stepId: 'approve' }),
        ref('amount.cents', { kind: 'step', stepId: 'approve' }),
      ],
      ledger,
    )
    expect(unresolved.map((entry) => entry.ref.path)).toEqual(['amount.cents'])
  })

  test('a ref naming the ancestor of a known entry resolves', () => {
    const unresolved = findUnresolvedRefs([ref('decision', { kind: 'step', stepId: 'approve' })], ledger)
    expect(unresolved).toEqual([])
  })

  test('a wildcard entry resolves every ref', () => {
    const wildcardLedger: ContextLedger = {
      steps: {
        start: {
          entries: [{ path: '*', type: 'unknown', presence: 'maybe', source: { kind: 'trigger', label: 'trigger:t1:payload' } }],
        },
      },
    }
    const unresolved = findUnresolvedRefs([ref('anything.at.all', { kind: 'step', stepId: 'start' })], wildcardLedger)
    expect(unresolved).toEqual([])
  })

  test('trigger-scoped refs and refs to steps without a ledger view are skipped', () => {
    const unresolved = findUnresolvedRefs(
      [
        ref('somewhere', { kind: 'trigger', triggerId: 'on-order' }),
        ref('somewhere', { kind: 'step', stepId: 'ghost' }),
      ],
      ledger,
    )
    expect(unresolved).toEqual([])
  })
})

describe('SUB_WORKFLOW mapped output keys resolve downstream', () => {
  const definition = (config: Record<string, unknown>): LedgerWorkflowDefinition => ({
    steps: [
      { stepId: 'start', stepType: 'START' },
      { stepId: 'child', stepType: 'SUB_WORKFLOW', config },
      {
        stepId: 'notify',
        stepType: 'AUTOMATED',
        activities: [
          {
            activityId: 'send',
            activityType: 'SEND_EMAIL',
            config: { subject: 'Approval {{context.approvalStatus}}' },
          },
        ],
      },
    ],
    transitions: [
      { transitionId: 'start-to-child', fromStepId: 'start', toStepId: 'child' },
      { transitionId: 'child-to-notify', fromStepId: 'child', toStepId: 'notify' },
    ],
  })

  test('a ref to a declared outputMapping target raises no unresolved-ref warning', () => {
    const withMapping = definition({ subWorkflowId: 'child-flow', outputMapping: { approvalStatus: 'result.status' } })
    const ledger = computeContextLedger(withMapping, { resolveOutputContract: () => 'unknown' })
    expect(collectUnresolvedContextRefWarnings(withMapping, ledger)).toEqual([])
  })

  test('the same ref still warns when the step declares no outputMapping', () => {
    const withoutMapping = definition({ subWorkflowId: 'child-flow' })
    const ledger = computeContextLedger(withoutMapping, { resolveOutputContract: () => 'unknown' })
    expect(collectUnresolvedContextRefWarnings(withoutMapping, ledger)).toEqual([
      { path: ['steps', 2, 'activities', 0, 'config', 'subject'], refPath: 'approvalStatus' },
    ])
  })
})

describe('collectUnresolvedContextRefWarnings + editor merge', () => {
  const definition: LedgerWorkflowDefinition = {
    steps: [
      { stepId: 'start', stepType: 'START' },
      { stepId: 'notify', stepType: 'AUTOMATED' },
      { stepId: 'end', stepType: 'END' },
    ],
    transitions: [
      {
        transitionId: 'start-to-notify',
        fromStepId: 'start',
        toStepId: 'notify',
        activities: [
          {
            activityId: 'send',
            activityType: 'SEND_EMAIL',
            config: {
              to: '{{context.recipientEmail}}',
              subject: 'Order {{context.missing.path}} ready {{context.missing.path}}',
            },
          },
        ],
      },
      { transitionId: 'notify-to-end', fromStepId: 'notify', toStepId: 'end' },
    ],
    contextSchema: {
      input: { fields: [{ name: 'recipientEmail', type: 'text', required: true }] },
    },
  }

  test('warns only on refs the client ledger cannot resolve, deduplicated per field', () => {
    const ledger = computeContextLedger(definition, { resolveOutputContract: () => 'unknown' })
    const warnings = collectUnresolvedContextRefWarnings(definition, ledger)
    expect(warnings).toEqual([
      {
        path: ['transitions', 0, 'activities', 0, 'config', 'subject'],
        refPath: 'missing.path',
      },
    ])
  })

  test('warnings map to the offending edge through collectValidationIssues as non-blocking warnings', () => {
    const ledger = computeContextLedger(definition, { resolveOutputContract: () => 'unknown' })
    const warnings = collectUnresolvedContextRefWarnings(definition, ledger)
    const nodes: Node[] = [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
      { id: 'notify', type: 'automated', position: { x: 0, y: 100 }, data: { label: 'Notify' } },
      { id: 'end', type: 'end', position: { x: 0, y: 200 }, data: { label: 'End' } },
    ]
    const edges: Edge[] = [
      { id: 'e-start-notify', source: 'start', target: 'notify', data: {} },
      { id: 'e-notify-end', source: 'notify', target: 'end', data: {} },
    ]

    const issues = collectValidationIssues({
      graphErrors: [],
      configWarnings: warnings.map((warning) => ({
        path: warning.path,
        message: `Unresolved context reference "${warning.refPath}"`,
      })),
      nodes,
      edges,
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'warning',
      edgeId: 'e-start-notify',
      message: 'transitions.0.activities.0.config.subject - Unresolved context reference "missing.path"',
    })
  })
})
