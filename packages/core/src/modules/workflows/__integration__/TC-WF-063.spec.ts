import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  listWorkflowInstanceEvents,
  listWorkflowInstanceSteps,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-063: SUB_WORKFLOW output ports mapped to differently named parent keys.
 *
 * `outputMapping` is `{ parentKey: childPath }` and the child's `io.outputs`
 * ports are named in the CHILD's vocabulary, so a renamed mapping
 * (`renamedValue ← childValue`) must validate `childValue` on the child output
 * and land it under `renamedValue`. Covers the inline (synchronous) completion,
 * a missing required port, and the parked child resumed by the
 * `resume_subworkflow_parent` job, where a downstream route reads the renamed
 * key from the parent context. Only the resumed path merges mapped output into
 * the parent context (workflows AGENTS.md → "SUB_WORKFLOW is PATH-DEPENDENT");
 * the inline path records it on the step instance, so that is what it asserts.
 *
 * The async case needs the workflow-activities worker — same skip condition as
 * TC-WF-016.
 */
const IS_STANDALONE_APP = Boolean(process.env.OM_TEST_APP_ROOT?.trim())

type SubWorkflowFixture = { parentWorkflowId: string; definitionIds: string[] }

const childOutputs = [
  { name: 'childValue', type: 'text', label: 'Child value', required: true },
  { name: 'childAmount', type: 'number', label: 'Child amount' },
]

function setVariable(activityId: string, assignments: Array<{ path: string; value: unknown }>) {
  return { activityId, activityName: activityId, activityType: 'SET_VARIABLE', async: false, config: { assignments } }
}

async function createSubWorkflowFixture(
  request: APIRequestContext,
  token: string,
  options: { suffix: string; childAssignments: Array<{ path: string; value: unknown }>; asyncChild?: boolean; readDownstream?: boolean },
): Promise<SubWorkflowFixture> {
  const stamp = `${Date.now()}-${options.suffix}`
  const childWorkflowId = `qa-wf-063-child-${stamp}`
  const parentWorkflowId = `qa-wf-063-parent-${stamp}`
  const definitionIds: string[] = []

  const childActivities = [
    ...(options.asyncChild
      ? [{ activityId: 'park', activityName: 'Park', activityType: 'WAIT', async: true, config: { duration: 'PT1S' } }]
      : []),
    setVariable('produce', options.childAssignments),
  ]

  definitionIds.push(
    await createWorkflowDefinitionFixture(request, token, {
      workflowId: childWorkflowId,
      workflowName: `QA TC-WF-063 child ${stamp}`,
      version: 1,
      enabled: true,
      definition: {
        io: { inputs: [], outputs: childOutputs },
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          { transitionId: 'start-end', fromStepId: 'start', toStepId: 'end', trigger: 'auto', activities: childActivities },
        ],
      },
    }),
  )

  definitionIds.push(
    await createWorkflowDefinitionFixture(request, token, {
      workflowId: parentWorkflowId,
      workflowName: `QA TC-WF-063 parent ${stamp}`,
      version: 1,
      enabled: true,
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          {
            stepId: 'call_child',
            stepName: 'Call child',
            stepType: 'SUB_WORKFLOW',
            config: {
              subWorkflowId: childWorkflowId,
              version: 1,
              inputMapping: {},
              outputMapping: { renamedValue: 'childValue', renamedAmount: 'childAmount' },
            },
          },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          { transitionId: 'start-call', fromStepId: 'start', toStepId: 'call_child', trigger: 'auto' },
          {
            transitionId: 'call-end',
            fromStepId: 'call_child',
            toStepId: 'end',
            trigger: 'auto',
            activities: options.readDownstream
              ? [setVariable('read_renamed', [{ path: 'downstreamCopy', value: '{{context.renamedValue}}' }])]
              : [],
          },
        ],
      },
    }),
  )

  return { parentWorkflowId, definitionIds }
}

async function cleanup(request: APIRequestContext, token: string, instanceId: string | null, fixture: SubWorkflowFixture | null) {
  await cancelWorkflowInstanceIfExists(request, token, instanceId)
  for (const definitionId of fixture?.definitionIds.reverse() ?? []) {
    await deleteWorkflowDefinitionIfExists(request, token, definitionId)
  }
}

test.describe('TC-WF-063: sub-workflow output ports mapped to renamed parent keys', () => {
  test('inline child: renamed required port is validated, coerced and mapped', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let fixture: SubWorkflowFixture | null = null
    let instanceId: string | null = null
    try {
      fixture = await createSubWorkflowFixture(request, token, {
        suffix: 'sync',
        childAssignments: [
          { path: 'childValue', value: 'port-alpha' },
          { path: 'childAmount', value: '42' },
        ],
      })
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId: fixture.parentWorkflowId, initialContext: {} })

      const finished = await pollWorkflowInstance(
        request, token, instanceId,
        (instance) => instance.status === 'COMPLETED' || instance.status === 'FAILED',
        { timeoutMs: 20_000 },
      )
      expect(finished?.status, `parent should complete (snapshot=${JSON.stringify(finished)})`).toBe('COMPLETED')

      const steps = await listWorkflowInstanceSteps(request, token, instanceId)
      const callStep = steps.find((step) => step.stepId === 'call_child')
      expect(callStep?.status).toBe('COMPLETED')
      expect(callStep?.outputData).toEqual({ renamedValue: 'port-alpha', renamedAmount: 42 })

      const completed = await listWorkflowInstanceEvents(request, token, instanceId, { eventType: 'SUB_WORKFLOW_COMPLETED' })
      expect(completed).toHaveLength(1)
      expect(completed[0]?.eventData).toMatchObject({ outputData: { renamedValue: 'port-alpha', renamedAmount: 42 } })
    } finally {
      await cleanup(request, token, instanceId, fixture)
    }
  })

  test('inline child: a missing required child port still fails the parent', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let fixture: SubWorkflowFixture | null = null
    let instanceId: string | null = null
    try {
      fixture = await createSubWorkflowFixture(request, token, {
        suffix: 'missing',
        childAssignments: [{ path: 'childAmount', value: 7 }],
      })
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId: fixture.parentWorkflowId, initialContext: {} })

      const finished = await pollWorkflowInstance(
        request, token, instanceId,
        (instance) => instance.status === 'COMPLETED' || instance.status === 'FAILED',
        { timeoutMs: 20_000 },
      )
      expect(finished?.status).toBe('FAILED')

      const failed = await listWorkflowInstanceEvents(request, token, instanceId, { eventType: 'SUB_WORKFLOW_FAILED' })
      expect(failed[0]?.eventData).toMatchObject({
        reason: 'OUTPUT_VALIDATION',
        error: 'Sub-workflow output validation failed: Required port "childValue" is missing',
      })
    } finally {
      await cleanup(request, token, instanceId, fixture)
    }
  })

  test('parked child: resume maps the renamed key into the parent context for downstream steps', async ({ request }) => {
    test.skip(IS_STANDALONE_APP, 'Sub-workflow resume needs the workflow-activities worker (AUTO_SPAWN_WORKERS=false in standalone)')
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    let fixture: SubWorkflowFixture | null = null
    let instanceId: string | null = null
    try {
      fixture = await createSubWorkflowFixture(request, token, {
        suffix: 'async',
        asyncChild: true,
        readDownstream: true,
        childAssignments: [
          { path: 'childValue', value: 'port-alpha' },
          { path: 'childAmount', value: '42' },
        ],
      })
      instanceId = await startWorkflowInstanceFixture(request, token, { workflowId: fixture.parentWorkflowId, initialContext: {} })

      const finished = await pollWorkflowInstance(
        request, token, instanceId,
        (instance) => instance.status === 'COMPLETED' || instance.status === 'FAILED',
        { timeoutMs: 90_000, intervalMs: 500 },
      )
      expect(finished?.status, `parent should complete after resume (snapshot=${JSON.stringify(finished)})`).toBe('COMPLETED')
      expect(finished?.context).toMatchObject({
        renamedValue: 'port-alpha',
        renamedAmount: 42,
        downstreamCopy: 'port-alpha',
      })
      expect(finished?.context).not.toHaveProperty('childValue')

      const awaiting = await listWorkflowInstanceEvents(request, token, instanceId, { eventType: 'SUB_WORKFLOW_COMPLETED' })
      expect(awaiting[0]?.eventData).toMatchObject({ outputData: { renamedValue: 'port-alpha', renamedAmount: 42 } })
    } finally {
      await cleanup(request, token, instanceId, fixture)
    }
  })
})
