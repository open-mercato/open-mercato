import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => {}),
}))

jest.mock('@open-mercato/shared/lib/commands', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands')
  return { ...actual, registerCommand: jest.fn() }
})

import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitAgentOrchestratorEvent } from '../events'
import { withProcessSubject, getProcessSubject } from '../lib/processes/subjectContext'
import '../commands/proposals'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '44444444-4444-4444-8444-444444444444'
const PROCESS = '33333333-3333-4333-8333-333333333333'

const SUBJECT = {
  subjectType: 'Motor',
  subjectLabel: 'CLM-2026-04417',
  subjectTitle: 'Motor collision — payout adjudication',
  valueMinor: 1840000,
  fraud: false,
}

function createCtx(): CommandRuntimeContext {
  const em = {
    fork() {
      return em
    },
    create(_entity: unknown, data: Record<string, unknown>) {
      return { id: 'proposal-1', ...data }
    },
    persist() {
      return em
    },
    async flush() {},
  }
  return {
    container: { resolve: (token: string) => (token === 'em' ? em : null) },
  } as unknown as CommandRuntimeContext
}

function proposalsCreateHandler() {
  const registered = (registerCommand as jest.Mock).mock.calls
    .map((call) => call[0] as { id: string; execute: (input: unknown, ctx: unknown) => Promise<unknown> })
    .find((command) => command.id === 'agent_orchestrator.proposals.create')
  if (!registered) throw new Error('proposals.create not registered')
  return registered
}

const INPUT = {
  tenantId: TENANT,
  organizationId: ORG,
  agentId: 'claims.intake',
  runId: RUN_ID,
  processId: PROCESS,
  stepId: 'intake',
  payload: { actions: [], rationale: 'ok' },
}

describe('subject propagation — INVOKE_AGENT subject → proposal.created payload', () => {
  beforeEach(() => {
    ;(emitAgentOrchestratorEvent as jest.Mock).mockClear()
  })

  it('binds and clears the async-scoped subject', async () => {
    expect(getProcessSubject()).toBeUndefined()
    await withProcessSubject(SUBJECT, async () => {
      expect(getProcessSubject()).toEqual(SUBJECT)
    })
    expect(getProcessSubject()).toBeUndefined()
  })

  it('a null subject binds nothing (fail-open)', async () => {
    await withProcessSubject(null, async () => {
      expect(getProcessSubject()).toBeUndefined()
    })
  })

  it('proposals.create emits the bound subject on proposal.created (never persisted)', async () => {
    const command = proposalsCreateHandler()
    await withProcessSubject(SUBJECT, async () => {
      await command.execute(INPUT, createCtx())
    })
    expect(emitAgentOrchestratorEvent).toHaveBeenCalledWith(
      'agent_orchestrator.proposal.created',
      expect.objectContaining({ processId: PROCESS, subject: SUBJECT }),
      { persistent: true },
    )
  })

  it('proposals.create outside a subject binding emits subject: null', async () => {
    const command = proposalsCreateHandler()
    await command.execute(INPUT, createCtx())
    expect(emitAgentOrchestratorEvent).toHaveBeenCalledWith(
      'agent_orchestrator.proposal.created',
      expect.objectContaining({ subject: null }),
      { persistent: true },
    )
  })
})
