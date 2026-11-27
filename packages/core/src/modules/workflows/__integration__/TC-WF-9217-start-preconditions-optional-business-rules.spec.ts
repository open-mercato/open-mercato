import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createBusinessRuleFixture,
  deleteBusinessRuleIfExists,
} from '@open-mercato/core/helpers/integration/businessRulesFixtures'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

export const integrationMeta = { dependsOnModules: ['workflows'] }

/**
 * TC-WF-9217 (START pre-conditions): starting a workflow whose START step declares
 * business-rule pre-conditions degrades cleanly when the optional `business_rules`
 * module is disabled (#9217).
 *
 * Normal path (business_rules enabled): a REQUIRED pre-condition naming an unknown
 * rule refuses the start with 422 START_PRE_CONDITIONS_FAILED / RULE_NOT_FOUND, and an
 * OPTIONAL one does not block the start.
 * Absent path (business_rules disabled): the required pre-condition refuses the start
 * with 422 START_PRE_CONDITIONS_FAILED / RULE_ENGINE_UNAVAILABLE (no 500 from a missing
 * BusinessRule metadata), and the optional one still lets the workflow start.
 */

type StartFailureBody = {
  error?: string
  code?: string
  details?: { errors?: Array<{ ruleId?: string; code?: string; message?: string }> }
}

async function isBusinessRulesModuleEnabled(request: APIRequestContext): Promise<boolean> {
  const superadminToken = await getAuthToken(request, 'superadmin')
  const probe = await apiRequest(request, 'GET', '/api/business_rules/rules?pageSize=1', { token: superadminToken })
  expect([200, 404], `business_rules probe answered ${probe.status()}`).toContain(probe.status())
  return probe.status() === 200
}

function buildPreConditionDefinition(workflowId: string, ruleId: string, required: boolean) {
  return {
    workflowId,
    workflowName: `QA TC-WF-9217 pre-conditions ${workflowId}`,
    version: 1,
    enabled: true,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START', preConditions: [{ ruleId, required }] },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [{ transitionId: 'start-to-end', fromStepId: 'start', toStepId: 'end', trigger: 'auto' }],
    },
  }
}

type StartValidation = {
  canStart: boolean
  errors?: Array<{ ruleId: string; code: string }>
  validatedRules?: Array<{ ruleId: string; passed: boolean }>
}

async function validateStart(
  request: APIRequestContext,
  token: string,
  workflowId: string,
  context: Record<string, unknown> = {},
) {
  const response = await apiRequest(request, 'POST', '/api/workflows/instances/validate-start', {
    token,
    data: { workflowId, context },
  })
  expect(response.status()).toBe(200)
  return readJsonSafe<StartValidation>(response)
}

async function startAndReadRefusal(
  request: APIRequestContext,
  token: string,
  ruleId: string,
): Promise<StartFailureBody | null> {
  const stamp = `${Date.now()}-${randomInt(1_000_000)}`
  const workflowId = `qa-wf-9217-pre-required-${stamp}`
  let definitionId: string | null = null
  try {
    definitionId = await createWorkflowDefinitionFixture(
      request,
      token,
      buildPreConditionDefinition(workflowId, ruleId, true),
    )
    const validation = await validateStart(request, token, workflowId)
    expect(validation?.canStart).toBe(false)
    expect(validation?.errors).toContainEqual(expect.objectContaining({ ruleId }))
    const response = await apiRequest(request, 'POST', '/api/workflows/instances', {
      token,
      data: { workflowId, initialContext: {} },
    })
    const body = await readJsonSafe<StartFailureBody>(response)
    expect(response.status(), `a failed required pre-condition refuses the start (got ${JSON.stringify(body)})`).toBe(422)
    expect(body?.code).toBe('START_PRE_CONDITIONS_FAILED')
    expect(body?.details?.errors?.map(({ ruleId, code }) => ({ ruleId, code }))).toEqual(
      validation?.errors?.map(({ ruleId, code }) => ({ ruleId, code })),
    )
    return body
  } finally {
    await deleteWorkflowDefinitionIfExists(request, token, definitionId)
  }
}

async function startWithOptionalPreCondition(request: APIRequestContext, token: string, ruleId: string): Promise<void> {
  const stamp = `${Date.now()}-${randomInt(1_000_000)}`
  const workflowId = `qa-wf-9217-pre-optional-${stamp}`
  let definitionId: string | null = null
  let instanceId: string | null = null
  try {
    definitionId = await createWorkflowDefinitionFixture(
      request,
      token,
      buildPreConditionDefinition(workflowId, ruleId, false),
    )
    const validation = await validateStart(request, token, workflowId)
    expect(validation?.canStart).toBe(true)
    instanceId = await startWorkflowInstanceFixture(request, token, { workflowId, initialContext: {} })
    expect(instanceId, 'an optional pre-condition never blocks the start').toBeTruthy()
  } finally {
    await cancelWorkflowInstanceIfExists(request, token, instanceId)
    await deleteWorkflowDefinitionIfExists(request, token, definitionId)
  }
}

test.describe('TC-WF-9217: START pre-conditions with and without the business_rules module', () => {
  test('required pre-conditions gate the start and optional ones do not', async ({ request }) => {
    test.setTimeout(90_000)

    const businessRulesEnabled = await isBusinessRulesModuleEnabled(request)
    const token = await getAuthToken(request, 'admin')
    const ruleId = `qa_9217_missing_${Date.now()}`

    const refusal = await startAndReadRefusal(request, token, ruleId)
    const error = refusal?.details?.errors?.find((candidate) => candidate.ruleId === ruleId)
    expect(error, 'the refusal names the failing pre-condition').toBeTruthy()
    if (businessRulesEnabled) {
      expect(error?.code, 'business_rules enabled: an unknown rule is RULE_NOT_FOUND').toBe('RULE_NOT_FOUND')
    }

    await startWithOptionalPreCondition(request, token, ruleId)
  })

  test('without business_rules a required pre-condition refuses the start with RULE_ENGINE_UNAVAILABLE', async ({ request }) => {
    test.setTimeout(90_000)

    const businessRulesEnabled = await isBusinessRulesModuleEnabled(request)
    test.skip(businessRulesEnabled, 'Requires an app without the optional business_rules module')

    const token = await getAuthToken(request, 'admin')
    const ruleId = `qa_9217_absent_${Date.now()}`

    const refusal = await startAndReadRefusal(request, token, ruleId)
    const codes = (refusal?.details?.errors ?? []).map((candidate) => candidate.code)
    expect(codes, 'business_rules disabled: the rule engine is reported unavailable').toEqual(['RULE_ENGINE_UNAVAILABLE'])

    await startWithOptionalPreCondition(request, token, ruleId)
  })
})

test('executes a saved START rule and reports when the same rule is disabled', async ({ request }) => {
  test.skip(!(await isBusinessRulesModuleEnabled(request)), 'Requires Business Rules')
  const token = await getAuthToken(request, 'superadmin')
  const suffix = `${Date.now()}_${randomInt(1_000_000)}`
  const workflowId = `qa-start-rule-${suffix.replace('_', '-')}`
  const ruleId = `qa_start_${suffix}`
  let ruleRowId: string | null = null
  let definitionId: string | null = null
  let instanceId: string | null = null

  try {
    ruleRowId = await createBusinessRuleFixture(request, token, {
      ...getTokenContext(token),
      ruleId,
      ruleName: 'QA Workflow START guard',
      ruleType: 'GUARD',
      entityType: 'qa_workflow',
      conditionExpression: { field: 'workflowContext.allowed', operator: '=', value: true },
      enabled: true,
      priority: 100,
    })
    definitionId = await createWorkflowDefinitionFixture(
      request, token, buildPreConditionDefinition(workflowId, ruleId, true),
    )

    const refused = await validateStart(request, token, workflowId, { allowed: false })
    expect(refused?.errors).toContainEqual(expect.objectContaining({ ruleId, code: 'PRE_CONDITION_FAILED' }))

    const allowed = await validateStart(request, token, workflowId, { allowed: true })
    expect(allowed?.canStart).toBe(true)
    expect(allowed?.validatedRules).toContainEqual(expect.objectContaining({ ruleId, passed: true }))
    instanceId = await startWorkflowInstanceFixture(request, token, { workflowId, initialContext: { allowed: true } })

    const update = await apiRequest(request, 'PUT', '/api/business_rules/rules', {
      token, data: { id: ruleRowId, enabled: false },
    })
    expect(update.status()).toBe(200)
    const disabled = await validateStart(request, token, workflowId, { allowed: true })
    expect(disabled?.errors).toContainEqual(expect.objectContaining({ ruleId, code: 'RULE_DISABLED' }))
  } finally {
    await cancelWorkflowInstanceIfExists(request, token, instanceId)
    await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    await deleteBusinessRuleIfExists(request, token, ruleRowId)
  }
})

test('applies required and optional named rules in the appropriate transition phase', async ({ request }) => {
  test.skip(!(await isBusinessRulesModuleEnabled(request)), 'Requires Business Rules')
  const token = await getAuthToken(request, 'superadmin')
  const suffix = `${Date.now()}_${randomInt(1_000_000)}`
  const ruleId = `qa_transition_${suffix}`
  let ruleRowId: string | null = null

  try {
    ruleRowId = await createBusinessRuleFixture(request, token, {
      ...getTokenContext(token),
      ruleId,
      ruleName: 'QA Workflow transition guard',
      ruleType: 'GUARD',
      entityType: 'qa_workflow',
      conditionExpression: { field: 'workflowContext.allowed', operator: '=', value: true },
      enabled: true,
      priority: 100,
    })

    for (const mode of ['required-pre', 'optional-pre-and-post', 'inline-only'] as const) {
      const workflowId = `qa-t-${mode[0]}-${suffix.replace('_', '-')}`
      let definitionId: string | null = null
      let instanceId: string | null = null
      try {
        definitionId = await createWorkflowDefinitionFixture(request, token, {
          workflowId,
          workflowName: 'QA Workflow transition',
          version: 1,
          enabled: true,
          definition: {
            steps: [
              { stepId: 'start', stepName: 'Start', stepType: 'START' },
              { stepId: 'end', stepName: 'End', stepType: 'END' },
            ],
            transitions: [{
              transitionId: 'start-to-end',
              fromStepId: 'start',
              toStepId: 'end',
              trigger: 'manual',
              ...(mode === 'inline-only'
                ? { condition: { field: 'allowed', operator: '=', value: false } }
                : {
                  preConditions: [{ ruleId, required: mode === 'required-pre' }],
                  postConditions: [{ ruleId, required: false }],
                }),
            }],
          },
        })
        instanceId = await startWorkflowInstanceFixture(request, token, { workflowId, initialContext: { allowed: false } })
        const instancePath = `/api/workflows/instances/${encodeURIComponent(instanceId)}`
        const advance = await apiRequest(request, 'POST', `${instancePath}/advance`, {
          token, data: { toStepId: 'end' },
        })
        expect(advance.status(), mode).toBe(mode === 'required-pre' ? 400 : 200)
        if (mode === 'required-pre') continue

        const events = await apiRequest(request, 'GET', `${instancePath}/events`, { token })
        expect(events.status()).toBe(200)
        const body = await readJsonSafe<{ data?: Array<{ eventType: string }> }>(events)
        const eventTypes = body?.data?.map(({ eventType }) => eventType) ?? []
        expect(eventTypes).toContain('TRANSITION_EXECUTED')
        if (mode === 'optional-pre-and-post') expect(eventTypes).toContain('TRANSITION_POST_CONDITION_FAILED')
        if (mode === 'inline-only') expect(eventTypes).not.toContain('TRANSITION_POST_CONDITION_FAILED')
      } finally {
        await cancelWorkflowInstanceIfExists(request, token, instanceId)
        await deleteWorkflowDefinitionIfExists(request, token, definitionId)
      }
    }
  } finally {
    await deleteBusinessRuleIfExists(request, token, ruleRowId)
  }
})
