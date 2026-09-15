/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import {
  AGENT_WORKFLOW_OWNER_MODULE,
  SINGLE_AGENT_STEP_ID,
  buildSingleAgentWorkflow,
  generatedWorkflowId,
  materializeSingleAgentWorkflow,
  readSingleAgentFromWorkflow,
} from '../lib/processes/materializeAgentWorkflow'
import type { ProcessSingleAgent } from '../data/validators'

/**
 * A single-agent process is still a WORKFLOW
 * (`.ai/specs/enterprise/agent-orchestrator/2026-09-06-business-process-workflow-unification.md` §1).
 *
 * Removing the agent-as-target shortcut must not remove the ability to express
 * the simplest useful process — so choosing an agent generates a real, ordinary
 * workflow definition instead of routing around the engine. These tests pin the
 * two halves that make that claim true: the graph is a graph the engine can
 * actually run, and it is owned rather than borrowed.
 */

const MODULE_ROOT = path.join(__dirname, '..')
const DEFINITION_ID = '44444444-4444-4444-8444-444444444444'
const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

const SINGLE_AGENT: ProcessSingleAgent = {
  agentId: 'deals.health_check',
  onResult: { autoApproveThreshold: 0.8, autoApproveMargin: 0 },
}

type Step = { stepId: string; stepType: string; milestone?: string; activities?: Array<Record<string, unknown>> }

function graph(input?: { milestoneKeys?: string[] }) {
  return buildSingleAgentWorkflow({ singleAgent: SINGLE_AGENT, ...input }) as {
    steps: Step[]
    transitions: Array<{ fromStepId: string; toStepId: string }>
    interpolation: string
  }
}

describe('the generated graph is one the engine can run', () => {
  it('is START → INVOKE_AGENT → END, wired end to end', () => {
    const built = graph()
    expect(built.steps.map((step) => step.stepType)).toEqual(['START', 'AUTOMATED', 'END'])
    expect(built.transitions).toEqual([
      expect.objectContaining({ fromStepId: 'start', toStepId: SINGLE_AGENT_STEP_ID }),
      expect.objectContaining({ fromStepId: SINGLE_AGENT_STEP_ID, toStepId: 'end' }),
    ])
  })

  it('carries the agent config the INVOKE_AGENT activity contract declares', () => {
    const agentStep = graph().steps.find((step) => step.stepId === SINGLE_AGENT_STEP_ID)!
    const activity = agentStep.activities![0] as { activityType: string; config: Record<string, unknown> }
    expect(activity.activityType).toBe('INVOKE_AGENT')
    expect(activity.config).toMatchObject({
      agentId: 'deals.health_check',
      onResult: { autoApproveThreshold: 0.8, autoApproveMargin: 0 },
    })
  })

  it('declares the proposal-ready signal — without it a parked review never wakes', () => {
    const agentStep = graph().steps.find((step) => step.stepId === SINGLE_AGENT_STEP_ID)! as unknown as {
      signalConfig: { signalName: string }
    }
    expect(agentStep.signalConfig.signalName).toBe('agent_orchestrator.proposal.ready')
  })

  it('announces the process’s final milestone from the step that finishes the work', () => {
    const agentStep = graph({ milestoneKeys: ['analysis_started', 'analysis_completed'] }).steps.find(
      (step) => step.stepId === SINGLE_AGENT_STEP_ID,
    )!
    expect(agentStep.milestone).toBe('analysis_completed')
  })

  it('declares no milestone when the process declares no vocabulary', () => {
    expect(graph().steps.find((step) => step.stepId === SINGLE_AGENT_STEP_ID)!.milestone).toBeUndefined()
  })
})

describe('the generated workflow id', () => {
  it('is deterministic, so regenerating updates rather than forking', () => {
    expect(generatedWorkflowId(DEFINITION_ID)).toBe(generatedWorkflowId(DEFINITION_ID))
    expect(generatedWorkflowId(DEFINITION_ID)).not.toBe(generatedWorkflowId('55555555-5555-4555-8555-555555555555'))
  })
})

describe('reading the agent config back', () => {
  it('round-trips through the generated graph — the workflow is the source of truth', () => {
    expect(readSingleAgentFromWorkflow(buildSingleAgentWorkflow({ singleAgent: SINGLE_AGENT }))).toMatchObject({
      agentId: 'deals.health_check',
      onResult: { autoApproveThreshold: 0.8, autoApproveMargin: 0 },
    })
  })

  it('answers null for a workflow that has grown past the shortcut — honestly undescribable', () => {
    // Once someone edits the generated workflow into something else, the
    // simplified form can no longer describe it, and pretending otherwise would
    // let the next save silently overwrite their work.
    expect(readSingleAgentFromWorkflow({ steps: [{ stepId: 'start', stepType: 'START' }] })).toBeNull()
    expect(readSingleAgentFromWorkflow(null)).toBeNull()
  })
})

describe('materializing it', () => {
  function makeContainer(upsert: jest.Mock, available = true) {
    return {
      resolve: (token: string) => {
        if (token !== 'workflowDefinitionAuthoring') throw new Error(`unexpected resolve(${token})`)
        if (!available) throw new Error('[internal] workflows module not registered')
        return { upsertOwnedDefinition: upsert, deleteOwnedDefinition: jest.fn() }
      },
    } as never
  }

  it('claims OWNERSHIP of the definition it writes, and passes the execution grant to it', async () => {
    const upsert = jest.fn(async () => ({ ok: true, definition: { workflowId: 'x' }, created: true }))
    const result = await materializeSingleAgentWorkflow(makeContainer(upsert), {} as never, {
      processDefinitionId: DEFINITION_ID,
      processName: 'Deal health check',
      singleAgent: SINGLE_AGENT,
      grantedFeatures: ['workflows.instances.view'],
      ...SCOPE,
    })

    expect(result).toEqual({ ok: true, workflowId: generatedWorkflowId(DEFINITION_ID) })
    expect(upsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ownerModule: AGENT_WORKFLOW_OWNER_MODULE,
        ownerId: DEFINITION_ID,
        workflowId: generatedWorkflowId(DEFINITION_ID),
        // Execution identity belongs to the workflow, which is where core
        // provisions the least-privilege principal every run acts as.
        grantedFeatures: ['workflows.instances.view'],
      }),
    )
  })

  it('refuses rather than overwriting a workflow that belongs to someone else', async () => {
    const upsert = jest.fn(async () => ({ ok: false, reason: 'owned_by_other', definition: { workflowId: 'x' } }))
    await expect(
      materializeSingleAgentWorkflow(makeContainer(upsert), {} as never, {
        processDefinitionId: DEFINITION_ID,
        processName: 'Deal health check',
        singleAgent: SINGLE_AGENT,
        ...SCOPE,
      }),
    ).resolves.toEqual({ ok: false, reason: 'owned_by_other' })
  })

  it('reports the peer being absent instead of pretending it generated something', async () => {
    await expect(
      materializeSingleAgentWorkflow(makeContainer(jest.fn(), false), {} as never, {
        processDefinitionId: DEFINITION_ID,
        processName: 'Deal health check',
        singleAgent: SINGLE_AGENT,
        ...SCOPE,
      }),
    ).resolves.toEqual({ ok: false, reason: 'workflows_unavailable' })
  })
})

/**
 * The retired vocabulary survives in PROSE — the comments that explain why the
 * split was removed are the most valuable thing in these files — so these
 * assertions read the code with comments stripped. Asserting over the raw source
 * would make documenting a decision indistinguishable from reversing it.
 */
function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(MODULE_ROOT, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('there is no second execution engine left', () => {
  it('the execution worker starts a workflow and nothing else', () => {
    const worker = readCode('workers/process-execution-starter.ts')
    expect(worker).toContain('workflowExecutor.startWorkflow')
    // The agent branch is what let a "simple" process give up retry, waits,
    // signals, cancellation and recovery.
    expect(worker).not.toContain('agentRuntime')
    expect(worker).not.toContain('targetType')
  })

  it('nothing correlates a run by creation time any more', () => {
    for (const file of ['workers/process-execution-starter.ts', 'lib/runtime/invokeAgentForWorkflow.ts']) {
      const source = readCode(file)
      expect(source).not.toContain("orderBy: { createdAt: 'desc' }")
      expect(source).not.toContain("orderBy: { createdAt: 'DESC' }")
    }
  })

  it('the deleted ledger leaves no trace in the module', () => {
    const entities = readCode('data/entities.ts')
    expect(entities).not.toContain('AgentProcessRun')
    expect(entities).not.toContain('agent_process_runs')
  })
})
