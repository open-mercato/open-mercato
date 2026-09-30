/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import { readSquashMigrationSql } from './helpers/squashMigration'

/**
 * An agent invocation has an IDENTITY
 * (`.ai/specs/enterprise/agent-orchestrator/2026-09-06-business-process-workflow-unification.md` §5).
 *
 * Before this, a caller found the run it had just caused by asking for "the
 * newest run for this agent created since T". Two concurrent runs of the same
 * agent in the same organization — a retry, a parallel branch, two instances of
 * the same process — are indistinguishable to that query, and it silently
 * disposes the wrong proposal. Correlation is now an explicit identifier:
 * `(workflowInstanceId, stepId, invocationId)`.
 */

const MODULE_ROOT = path.join(__dirname, '..')
const REPO_ROOT = path.join(MODULE_ROOT, '..', '..', '..', '..', '..')
const WORKFLOWS_LIB = path.join(REPO_ROOT, 'packages', 'core', 'src', 'modules', 'workflows', 'lib')

function read(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

describe('the schema enforces one run per invocation', () => {
  const migration = readSquashMigrationSql()

  it('declares the invocation id alongside the instance and the step', () => {
    expect(migration).toContain('"workflow_instance_id" uuid null')
    expect(migration).toContain('"step_id" varchar(100) null')
    expect(migration).toContain('"invocation_id" varchar(100) null')
  })

  it('makes the triple unique — the identity is enforced, not merely intended', () => {
    expect(migration).toContain(
      'create unique index "agent_runs_invocation_uq" on "agent_runs" ("workflow_instance_id", "step_id", "invocation_id")',
    )
  })

  it('leaves Playground and eval runs unconstrained — they correlate to nothing', () => {
    // A partial index: a run with no workflow behind it is not "one invocation of
    // a step", and a unique index over three nulls would refuse the second one.
    const index = migration.slice(
      migration.indexOf('create unique index "agent_runs_invocation_uq"'),
    )
    expect(index.slice(0, index.indexOf(';'))).toContain(
      'where "workflow_instance_id" is not null and "step_id" is not null and "invocation_id" is not null',
    )
  })
})

describe('the invocation id travels from the engine to the run', () => {
  it('the executor names the step ATTEMPT, not the step', () => {
    // A retry enters the step again and mints a new StepInstance, so its id names
    // this attempt and no other — which is exactly what makes a retried
    // invocation distinguishable from the one it retried.
    const executor = read(path.join(WORKFLOWS_LIB, 'activity-executor.ts'))
    expect(executor).toContain('invocationId: context.stepInstanceId')
  })

  it('the worker carries it across the process boundary on the job itself', () => {
    const worker = read(path.join(WORKFLOWS_LIB, 'activity-worker-handler.ts'))
    expect(worker).toContain('invocationId: payload.stepInstanceId')
  })

  it('both runners stamp it onto the run row', () => {
    for (const runner of ['nativeAgentRunner.ts', 'openCodeAgentRunner.ts']) {
      const source = read(path.join(MODULE_ROOT, 'lib', 'runtime', runner))
      expect(source).toContain('invocationId: ctx.invocationId ?? null')
    }
  })
})

describe('the proposal is found by the run that produced it', () => {
  const bridge = read(path.join(MODULE_ROOT, 'lib', 'runtime', 'invokeAgentForWorkflow.ts'))

  it('learns the run id from the run rather than guessing afterwards', () => {
    expect(bridge).toContain('onRunPersisted')
    expect(bridge).toContain('if (!topLevelRunId) topLevelRunId = runId')
  })

  it('looks the proposal up by runId', () => {
    expect(bridge).toContain('runId: topLevelRunId')
  })

  it('no longer orders pending proposals by creation time', () => {
    expect(bridge).not.toContain("orderBy: { createdAt: 'DESC' }")
  })

  it('still accepts the none_proposed disposition — a run that proposed nothing is not a missing proposal', () => {
    expect(bridge).toContain("disposition: { $in: ['pending', 'none_proposed'] }")
  })
})
