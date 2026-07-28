/**
 * Step 2.9 (workflows UX Phase 3a, issue #4236): dependency visibility for
 * business rules. Workflows resolves its OWN usage — business_rules never
 * imports workflows — so the collector below is the whole contract.
 */
import {
  collectBusinessRuleUsage,
  countReferencingWorkflows,
  findBusinessRuleUsage,
  type BusinessRuleUsageDefinition,
} from '../business-rule-usage'

const definitions: BusinessRuleUsageDefinition[] = [
  {
    workflowId: 'order-approval',
    version: 2,
    name: 'Order approval',
    definition: {
      steps: [
        { stepId: 'start', stepType: 'START', preConditions: [{ ruleId: 'ORDER_LIMIT', required: true }] },
        { stepId: 'review', stepType: 'USER_TASK' },
      ],
      transitions: [
        {
          transitionId: 'e_start_review',
          fromStepId: 'start',
          toStepId: 'review',
          preConditions: [{ ruleId: 'ORDER_LIMIT', required: true }],
          postConditions: [{ ruleId: 'AUDIT_TRAIL', required: false }],
        },
      ],
    },
  },
  {
    workflowId: 'refund-flow',
    version: 1,
    definition: {
      steps: [{ stepId: 'start', stepType: 'START' }],
      transitions: [
        {
          transitionId: 'e_start_end',
          fromStepId: 'start',
          toStepId: 'end',
          preConditions: ['ORDER_LIMIT'],
        },
      ],
    },
  },
  {
    workflowId: 'unrelated',
    version: 1,
    definition: { steps: [], transitions: [] },
  },
]

describe('collectBusinessRuleUsage', () => {
  it('finds START pre-conditions and transition pre/post-conditions across workflows', () => {
    const references = collectBusinessRuleUsage(definitions, 'ORDER_LIMIT')

    expect(references).toEqual([
      { workflowId: 'order-approval', version: 2, workflowName: 'Order approval', kind: 'startPreCondition', locationId: 'start' },
      { workflowId: 'order-approval', version: 2, workflowName: 'Order approval', kind: 'transitionPreCondition', locationId: 'e_start_review' },
      { workflowId: 'refund-flow', version: 1, kind: 'transitionPreCondition', locationId: 'e_start_end' },
    ])
  })

  it('reads post-conditions and the legacy bare-string condition form', () => {
    expect(collectBusinessRuleUsage(definitions, 'AUDIT_TRAIL')).toEqual([
      { workflowId: 'order-approval', version: 2, workflowName: 'Order approval', kind: 'transitionPostCondition', locationId: 'e_start_review' },
    ])
  })

  it('returns nothing for an unreferenced rule or an empty rule id', () => {
    expect(collectBusinessRuleUsage(definitions, 'NEVER_USED')).toEqual([])
    expect(collectBusinessRuleUsage(definitions, '')).toEqual([])
  })

  it('tolerates malformed definitions instead of throwing', () => {
    const malformed: BusinessRuleUsageDefinition[] = [
      { workflowId: 'broken', version: 1, definition: null },
      { workflowId: 'broken-2', version: 1, definition: { steps: 'nope', transitions: 7 } },
      { workflowId: 'broken-3', version: 1, definition: { transitions: [{ preConditions: [{ ruleId: 'ORDER_LIMIT' }] }] } },
    ]
    expect(collectBusinessRuleUsage(malformed, 'ORDER_LIMIT')).toEqual([])
  })

  it('counts distinct workflows, not references', () => {
    expect(countReferencingWorkflows(collectBusinessRuleUsage(definitions, 'ORDER_LIMIT'))).toBe(2)
  })
})

describe('findBusinessRuleUsage', () => {
  it('scopes the scan by tenant and organization', async () => {
    const execute = jest.fn().mockResolvedValue([
      {
        workflow_id: 'order-approval',
        version: 2,
        workflow_name: 'Order approval',
        definition: JSON.stringify({
          steps: [],
          transitions: [{ transitionId: 't1', preConditions: [{ ruleId: 'ORDER_LIMIT' }] }],
        }),
      },
    ])
    const em = { getConnection: () => ({ execute }) } as never

    const references = await findBusinessRuleUsage(em, {
      ruleId: 'ORDER_LIMIT',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(execute).toHaveBeenCalledTimes(1)
    const [sql, params] = execute.mock.calls[0]
    expect(sql).toContain('tenant_id = ?')
    expect(sql).toContain('organization_id = ?')
    expect(sql).toContain('deleted_at is null')
    expect(params.slice(0, 2)).toEqual(['tenant-1', 'org-1'])
    expect(references).toEqual([
      { workflowId: 'order-approval', version: 2, workflowName: 'Order approval', kind: 'transitionPreCondition', locationId: 't1' },
    ])
  })

  it('never queries for an empty rule id', async () => {
    const execute = jest.fn()
    const em = { getConnection: () => ({ execute }) } as never
    await expect(findBusinessRuleUsage(em, { ruleId: '', tenantId: 't', organizationId: 'o' })).resolves.toEqual([])
    expect(execute).not.toHaveBeenCalled()
  })
})
