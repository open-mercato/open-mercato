/**
 * The deal-briefing workflow definition.
 *
 * Two of these tests are the ones that matter, because everything they cover
 * fails only at RUN time — after a definition has been seeded, after a button
 * has been pressed, and in the voice step's case after a real person has been
 * phoned:
 *
 *  1. the definition must parse against the engine's own
 *     `workflowDefinitionDataSchema` and evaluate with ZERO errors through
 *     `evaluateWorkflowDefinition` (the Studio's Problems panel and the
 *     definition API routes share that one evaluator). A definition that fails
 *     it cannot be seeded at all;
 *  2. every `agentId`, `commandId` and `eventName` the JSON names must exist —
 *     checked against the REAL registries, never by eye. An id the registry
 *     cannot resolve fails deep inside a run, several minutes and one phone
 *     call in.
 *
 * The remaining tests pin the decisions the JSON encodes that a later edit
 * could plausibly undo without any test noticing: the outcome handles, the
 * `call.reached` branch, the two DIFFERENT company ids, and the literal failure
 * causes B4's closed vocabulary requires.
 */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
}))

import '../workflows'
import '../commands/ensureTask'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { getDeclaredEvents } from '@open-mercato/shared/modules/events'
import { getAgentEntry } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineAgent'
import { workflowDefinitionDataSchema } from '@open-mercato/core/modules/workflows/data/validators'
import { evaluateWorkflowDefinition } from '@open-mercato/core/modules/workflows/lib/definition-evaluation'
import { AGENT_OUTCOME_KINDS } from '@open-mercato/core/modules/workflows/lib/outcome-routing'
import '../ai-agents'
import {
  DEAL_BRIEF_AGENT_ID,
  SALES_CHIEF_CALL_AGENT_ID,
  TASK_EXTRACTOR_AGENT_ID,
} from '../ai-agents'
import {
  BRIEF_COMPLETED_EVENT_ID,
  BRIEF_FAILED_EVENT_ID,
  BRIEF_FAILURE_CAUSES,
} from '../events'
import {
  DEAL_BRIEFING_WORKFLOW_ID,
  readDealBriefingDefinition,
  seedDealBriefingWorkflow,
} from '../lib/seeds'
import workflowJson from '../examples/deal-briefing-workflow.json'

const ENSURE_TASK_COMMAND_ID = 'sales_call_planner.ensure_task'

type JsonRecord = Record<string, unknown>

const document = workflowJson as unknown as {
  workflowId: string
  workflowName: string
  version: number
  enabled: boolean
  definition: {
    contextSchema?: { input?: { fields: Array<{ name: string; type: string; required?: boolean }> } }
    steps: JsonRecord[]
    transitions: JsonRecord[]
  }
}

const steps = document.definition.steps
const transitions = document.definition.transitions

const stepById = (stepId: string): JsonRecord | undefined =>
  steps.find((step) => step.stepId === stepId)
const transitionById = (transitionId: string): JsonRecord | undefined =>
  transitions.find((transition) => transition.transitionId === transitionId)

function activitiesOf(holder: JsonRecord | undefined): JsonRecord[] {
  return (holder?.activities as JsonRecord[] | undefined) ?? []
}

function allActivities(): JsonRecord[] {
  return [...steps, ...transitions].flatMap((holder) => activitiesOf(holder))
}

function activitiesOfType(activityType: string): JsonRecord[] {
  return allActivities().filter((activity) => activity.activityType === activityType)
}

function configOf(activity: JsonRecord): JsonRecord {
  return (activity.config as JsonRecord | undefined) ?? {}
}

function agentStepIds(): string[] {
  return steps
    .filter((step) => activitiesOf(step).some((activity) => activity.activityType === 'INVOKE_AGENT'))
    .map((step) => String(step.stepId))
}

describe('deal-briefing workflow definition', () => {
  it('carries the exported, unversioned workflow id', () => {
    expect(document.workflowId).toBe(DEAL_BRIEFING_WORKFLOW_ID)
    // The row's `version` column is what `findWorkflowDefinition` resolves
    // against; a `_v1` in the id would make v2 a different workflow.
    expect(document.workflowId).not.toMatch(/_v\d+$/)
    expect(document.version).toBe(1)
    expect(document.enabled).toBe(true)
  })

  it('parses against workflowDefinitionDataSchema', () => {
    const parsed = workflowDefinitionDataSchema.safeParse(document.definition)
    if (!parsed.success) {
      throw new Error(
        `definition failed schema:\n${parsed.error.issues
          .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
          .join('\n')}`,
      )
    }
    expect(parsed.success).toBe(true)
  })

  it('evaluates with zero ERRORS through the Studio’s own evaluator', () => {
    const evaluation = evaluateWorkflowDefinition(readDealBriefingDefinition())
    if (evaluation.errorCount > 0) {
      throw new Error(
        `definition has blocking problems:\n${evaluation.problems
          .filter((problem) => problem.severity === 'error')
          .map((problem) => `  ${problem.message}`)
          .join('\n')}`,
      )
    }
    expect(evaluation.valid).toBe(true)
    expect(evaluation.issues).toEqual([])
  })

  it('is seedable: the shipped file survives the seeder’s own parse', () => {
    expect(readDealBriefingDefinition().steps).toHaveLength(steps.length)
  })
})

describe('deal-briefing workflow seeding', () => {
  const TENANT_ID = '11111111-1111-4111-8111-111111111111'
  const ORG_ID = '22222222-2222-4222-8222-222222222222'

  function fakeEm(existing: unknown) {
    return {
      findOne: jest.fn().mockResolvedValue(existing),
      create: jest.fn((_entity: unknown, data: unknown) => data),
      persist: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
    }
  }

  it('probes the tuple the DB constraint actually names, WITHOUT the organization', async () => {
    // `workflow_definitions` is unique on (workflow_id, version, tenant_id) —
    // no organization column. An org-scoped probe finds nothing for a tenant's
    // SECOND organization and the insert then hits the tenant-wide constraint,
    // which is exactly how `yarn mercato seed:defaults` (it loops over every
    // organization) crashed against a four-organization dev tenant.
    const em = fakeEm(null)
    await seedDealBriefingWorkflow(em as never, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })

    const [, where] = em.findOne.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(where).toEqual({
      workflowId: DEAL_BRIEFING_WORKFLOW_ID,
      version: 1,
      tenantId: TENANT_ID,
    })
    expect(where).not.toHaveProperty('organizationId')
  })

  it('writes the parsed definition once and nothing on a re-run', async () => {
    const first = fakeEm(null)
    expect(
      await seedDealBriefingWorkflow(first as never, {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      }),
    ).toBe(true)
    const [, row] = first.create.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(row.workflowId).toBe(DEAL_BRIEFING_WORKFLOW_ID)
    expect(row.version).toBe(1)
    expect(row.enabled).toBe(true)
    expect(row.organizationId).toBe(ORG_ID)
    expect((row.definition as { steps: unknown[] }).steps).toHaveLength(steps.length)

    const second = fakeEm({ id: 'existing' })
    expect(
      await seedDealBriefingWorkflow(second as never, {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      }),
    ).toBe(false)
    expect(second.create).not.toHaveBeenCalled()
    expect(second.flush).not.toHaveBeenCalled()
  })
})

describe('deal-briefing workflow ids resolve against the real registries', () => {
  it('names only agents the orchestrator registry knows', () => {
    const named = activitiesOfType('INVOKE_AGENT').map((activity) => configOf(activity).agentId)
    expect(named).toEqual([
      DEAL_BRIEF_AGENT_ID,
      SALES_CHIEF_CALL_AGENT_ID,
      TASK_EXTRACTOR_AGENT_ID,
    ])
    for (const agentId of named) {
      expect(getAgentEntry(String(agentId))).toBeDefined()
    }
  })

  it('names only a command declared workflow-safe AND registered on the bus', () => {
    const named = activitiesOfType('UPDATE_ENTITY').map((activity) => configOf(activity).commandId)
    expect(named).toEqual([ENSURE_TASK_COMMAND_ID])
    expect(commandRegistry.has(ENSURE_TASK_COMMAND_ID)).toBe(true)
  })

  it('names only events this module declares', () => {
    const declared = new Set(getDeclaredEvents().map((event) => event.id))
    const named = new Set(activitiesOfType('EMIT_EVENT').map((activity) => configOf(activity).eventName))
    expect(named).toEqual(new Set([BRIEF_COMPLETED_EVENT_ID, BRIEF_FAILED_EVENT_ID]))
    for (const eventName of named) {
      expect(declared.has(String(eventName))).toBe(true)
    }
  })

  it('waits on the signal agent_orchestrator fires, on every agent step', () => {
    for (const stepId of agentStepIds()) {
      const signalConfig = stepById(stepId)?.signalConfig as JsonRecord | undefined
      expect(signalConfig?.signalName).toBe('agent_orchestrator.proposal.ready')
    }
  })
})

describe('deal-briefing workflow outcome routing', () => {
  it('wires researcher as the happy path off every agent step', () => {
    // All three agents are researcher-kind, so `approved` and `rejected` are
    // unreachable: there is no proposal to approve or decline. Wiring them
    // would be dead weight that reads like a governance decision.
    for (const stepId of agentStepIds()) {
      const outcomes = transitions
        .filter((transition) => transition.fromStepId === stepId && transition.kind === 'outcome')
        .map((transition) => String(transition.outcomeKind))
      expect(new Set(outcomes)).toEqual(new Set(['researcher', 'error', 'guardrailBlocked']))
      expect(new Set(outcomes).size).toBe(outcomes.length)
    }
  })

  it('claims only handles from the platform’s fixed five', () => {
    for (const transition of transitions) {
      if (transition.kind !== 'outcome') continue
      expect(AGENT_OUTCOME_KINDS).toContain(transition.outcomeKind)
    }
  })

  it('keeps the voice step out of every PARALLEL_FORK branch', () => {
    // An out-of-band agent inside a branch is refused by the engine — and by
    // then the call has already been placed.
    expect(steps.some((step) => step.stepType === 'PARALLEL_FORK')).toBe(false)
  })
})

describe('deal-briefing workflow output mapping', () => {
  it('maps each researcher OUTCOME onto the context key the next step reads', () => {
    const mappings = activitiesOfType('INVOKE_AGENT').map((activity) => configOf(activity).outputMapping)
    expect(mappings).toEqual([{ brief: 'data' }, { call: 'data' }, { plan: 'data' }])
  })

  it('reads the spoken brief and the CRM’s own company name out of the mapped brief', () => {
    const call = configOf(activitiesOfType('INVOKE_AGENT')[1]).input as JsonRecord
    expect(call.brief).toBe('{{context.brief.spokenSummary}}')
    expect(call.toNumber).toBe('{{context.chiefOfSalesPhone}}')
    // B2's operator documentation tells the provider-side prompt author to
    // write against {{company_name}}; changing this key silently breaks a
    // prompt this repo cannot see.
    expect(call.variables).toEqual({ company_name: '{{context.brief.companyName}}' })
  })

  it('hands the extractor both mapped objects, not re-derived ones', () => {
    expect(configOf(activitiesOfType('INVOKE_AGENT')[2]).input).toEqual({
      brief: '{{context.brief}}',
      call: '{{context.call}}',
    })
  })

  it('counts the tasks from the ensure-task envelope, under `result`', () => {
    // `executeUpdateEntity` nests the command's own output under `result`, and
    // a transition activity lands in context under its activityName.
    const completed = activitiesOf(transitionById('t_tasks_recorded')).find(
      (activity) => activity.activityType === 'EMIT_EVENT',
    )
    expect((configOf(completed!).payload as JsonRecord).taskCount).toBe(
      '{{context.ensure_tasks.result.ensured}}',
    )
    const ensure = activitiesOf(transitionById('t_tasks_recorded')).find(
      (activity) => activity.activityType === 'UPDATE_ENTITY',
    )
    expect(ensure?.activityName).toBe('ensure_tasks')
    // The name IS the context key, so it must stay a single dot-free token —
    // `getNestedValue` splits the interpolation path on '.'.
    expect(String(ensure?.activityName)).not.toContain('.')
  })
})

describe('deal-briefing workflow company ids', () => {
  it('declares companyId and the phone as required inputs', () => {
    const fields = document.definition.contextSchema?.input?.fields ?? []
    const byName = new Map(fields.map((field) => [field.name, field]))
    expect(byName.get('companyId')?.required).toBe(true)
    expect(byName.get('chiefOfSalesPhone')?.required).toBe(true)
    // There is no `uuid` field type in the context-schema vocabulary.
    for (const field of fields) expect(field.type).toBe('text')
  })

  it('passes the CustomerEntity id as the task’s timeline parent', () => {
    // `ensureTaskInputSchema.entityId` is a `customer_entities.id` — the parent
    // `requireTimelineParentEntity` resolves — and NOT `customer_companies.id`,
    // which is the separate profile row. The companies detail route keys on the
    // entity id, so the run's own `companyId` IS that id and no second lookup
    // is needed; the profile id never enters this definition.
    const ensure = activitiesOf(transitionById('t_tasks_recorded')).find(
      (activity) => activity.activityType === 'UPDATE_ENTITY',
    )
    expect(configOf(ensure!).input).toEqual({
      workflowInstanceId: '{{workflow.instanceId}}',
      stepId: '{{workflow.currentStepId}}',
      entityId: '{{context.companyId}}',
      tasks: '{{context.plan.tasks}}',
    })
  })

  it('gives every emitted event the same company id the detail route uses', () => {
    for (const activity of activitiesOfType('EMIT_EVENT')) {
      expect((configOf(activity).payload as JsonRecord).companyId).toBe('{{context.companyId}}')
    }
  })

  it('never interpolates an optional path without a default, because EMIT_EVENT throws on one', () => {
    // `companyName` is optional and nothing enforces `required` at start time,
    // so a bare {{context.companyName}} would leave the literal template in the
    // payload and `executeEmitEvent` would throw — losing the very event that
    // reports the failure. The `default('')` transform resolves it to '', which
    // B4's reader treats as absent and replaces with the company id.
    for (const activity of activitiesOfType('EMIT_EVENT')) {
      expect((configOf(activity).payload as JsonRecord).companyName).toBe(
        "{{ context.companyName | default('') }}",
      )
    }
  })
})

describe('deal-briefing workflow failure reporting', () => {
  it('emits a LITERAL cause from B4’s closed vocabulary on every failure route', () => {
    const failureCauses = activitiesOfType('EMIT_EVENT')
      .filter((activity) => configOf(activity).eventName === BRIEF_FAILED_EVENT_ID)
      .map((activity) => (configOf(activity).payload as JsonRecord).cause)

    expect(failureCauses.length).toBeGreaterThan(0)
    for (const cause of failureCauses) {
      expect(BRIEF_FAILURE_CAUSES).toContain(cause)
      // Never {{context.__error}}: anything unrecognised is coerced to
      // `unknown`, and a raw error string must not reach a notification row.
      expect(String(cause)).not.toContain('{{')
    }
  })

  it('reports every reachable failure kind, including the ones only wiring can name', () => {
    const causes = new Set(
      activitiesOfType('EMIT_EVENT')
        .filter((activity) => configOf(activity).eventName === BRIEF_FAILED_EVENT_ID)
        .map((activity) => (configOf(activity).payload as JsonRecord).cause),
    )
    expect(causes).toEqual(
      new Set(['agentError', 'guardrailBlocked', 'callNotReached', 'taskCreationFailed']),
    )
  })

  it('routes every failure to the visible END step rather than a bare instance failure', () => {
    const failing = transitions.filter((transition) =>
      activitiesOf(transition).some(
        (activity) => configOf(activity).eventName === BRIEF_FAILED_EVENT_ID,
      ),
    )
    for (const transition of failing) expect(transition.toStepId).toBe('brief_failed')
    expect(stepById('brief_failed')?.stepType).toBe('END')
  })

  it('catches a failed task write on a NORMAL route, where an error route can absorb it', () => {
    // An outcome route whose activities fail goes straight to OUTCOME_UNHANDLED
    // and fails the instance — the error route is never consulted. That is why
    // the CRM write hangs off `record_tasks` instead of off the agent step.
    expect(transitionById('t_tasks_recorded')?.kind).toBeUndefined()
    expect(transitionById('t_tasks_recorded')?.fromStepId).toBe('record_tasks')
    expect(transitionById('t_tasks_failed')?.kind).toBe('error')
    expect(transitionById('t_tasks_failed')?.fromStepId).toBe('record_tasks')
    expect(activitiesOf(stepById('record_tasks'))).toEqual([])
  })

  it('retries only the write that is idempotent by construction', () => {
    // B3's ensure-task command converges on a retry; an INVOKE_AGENT retry on
    // the voice step would re-enqueue a real outbound phone call, so no agent
    // activity declares a policy (the executor default is a single attempt).
    const ensure = activitiesOf(transitionById('t_tasks_recorded')).find(
      (activity) => activity.activityType === 'UPDATE_ENTITY',
    )
    expect((ensure?.retryPolicy as JsonRecord | undefined)?.maxAttempts).toBe(3)
    for (const activity of activitiesOfType('INVOKE_AGENT')) {
      expect(activity.retryPolicy).toBeUndefined()
    }
  })
})

describe('deal-briefing workflow call.reached branch', () => {
  it('branches on the call outcome instead of announcing success over an empty list', () => {
    // The extractor returns an empty task list for an unanswered call, so
    // without this branch the run would write nothing and then report a
    // completed briefing. The condition cannot live on the outcome route:
    // `resolveAgentOutcomeHandling` picks the highest-priority route for the
    // handle and never evaluates `condition`.
    expect(stepById('check_reached')?.stepType).toBe('IF_ELSE')
    const reached = transitionById('t_reached')
    expect(reached?.condition).toEqual({ field: 'call.reached', operator: '==', value: true })
    expect(reached?.toStepId).toBe('extract_tasks')

    const otherwise = transitionById('t_not_reached')
    expect(otherwise?.condition).toBeUndefined()
    expect(otherwise?.toStepId).toBe('brief_failed')
    expect(Number(reached?.priority)).toBeGreaterThan(Number(otherwise?.priority))
  })
})
