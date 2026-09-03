import type { EventArgs } from '@mikro-orm/core'
import {
  withAgentActor,
  withAuditedCommand,
  getAgentActorScope,
  isAuditedCommandActive,
} from '../lib/identity/agentWriteScope'
import {
  AgentKindNoBypassSubscriber,
  AgentWriteBypassError,
} from '../lib/identity/agentNoBypassSubscriber'

const AGENT_USER = 'agent-user-1'
const HUMAN = 'human-1'

function fakeEventArgs(entityName = 'SomeEntity'): EventArgs<unknown> {
  return {
    entity: {},
    meta: { className: entityName },
  } as unknown as EventArgs<unknown>
}

/**
 * Release-gate test (Wave 4 Phase 3, layer B-a) — backstops the no-bypass
 * invariant: no `kind='agent'` actor can write outside the audited Command path.
 * It asserts the runtime control (layer B-b) directly so a future regression that
 * removes the flush-time interceptor or the audited-command wrapping fails CI.
 */
describe('agent no-bypass enforcement (three-layer)', () => {
  describe('async-scope signals (the interceptor keys off these)', () => {
    it('binds the agent-actor scope for the run and clears it after', async () => {
      expect(getAgentActorScope()).toBeUndefined()
      await withAgentActor({ agentUserId: AGENT_USER, onBehalfOfUserId: HUMAN }, async () => {
        expect(getAgentActorScope()).toEqual({ agentUserId: AGENT_USER, onBehalfOfUserId: HUMAN })
        expect(isAuditedCommandActive()).toBe(false)
        await withAuditedCommand(async () => {
          expect(isAuditedCommandActive()).toBe(true)
        })
        expect(isAuditedCommandActive()).toBe(false)
      })
      expect(getAgentActorScope()).toBeUndefined()
    })
  })

  describe('AgentKindNoBypassSubscriber (layer B-b, fail-closed)', () => {
    const subscriber = new AgentKindNoBypassSubscriber()

    it('lets HUMAN writes pass (no agent-actor scope active)', () => {
      // No withAgentActor wrapper → guard never fires.
      expect(() => subscriber.beforeCreate(fakeEventArgs())).not.toThrow()
      expect(() => subscriber.beforeUpdate(fakeEventArgs())).not.toThrow()
      expect(() => subscriber.beforeDelete(fakeEventArgs())).not.toThrow()
    })

    it('lets PROPERLY-ATTRIBUTED agent writes pass (inside an audited command)', async () => {
      await withAgentActor({ agentUserId: AGENT_USER, onBehalfOfUserId: HUMAN }, async () => {
        await withAuditedCommand(async () => {
          expect(() => subscriber.beforeCreate(fakeEventArgs('AgentRun'))).not.toThrow()
          expect(() => subscriber.beforeUpdate(fakeEventArgs('AgentProposal'))).not.toThrow()
        })
      })
    })

    it('THROWS fail-closed on a raw agent write (agent actor active, no audited command)', async () => {
      await withAgentActor({ agentUserId: AGENT_USER, onBehalfOfUserId: HUMAN }, async () => {
        expect(() => subscriber.beforeCreate(fakeEventArgs('SalesOrder'))).toThrow(AgentWriteBypassError)
        expect(() => subscriber.beforeUpdate(fakeEventArgs('SalesOrder'))).toThrow(AgentWriteBypassError)
        expect(() => subscriber.beforeDelete(fakeEventArgs('SalesOrder'))).toThrow(AgentWriteBypassError)
      })
    })

    it('the thrown error names the operation + entity for audit (non-vacuous)', async () => {
      await withAgentActor({ agentUserId: AGENT_USER }, async () => {
        try {
          subscriber.beforeCreate(fakeEventArgs('SalesOrder'))
          throw new Error('expected the guard to throw')
        } catch (err) {
          expect(err).toBeInstanceOf(AgentWriteBypassError)
          expect((err as Error).message).toContain('create')
          expect((err as Error).message).toContain('SalesOrder')
          expect((err as AgentWriteBypassError).code).toBe('agent_write_bypass')
        }
      })
    })
  })

  describe('regression guard: removing the interceptor would break this test', () => {
    it('a raw agent write is impossible — the guard is the only thing stopping it', async () => {
      const subscriber = new AgentKindNoBypassSubscriber()
      let threw = false
      await withAgentActor({ agentUserId: AGENT_USER }, async () => {
        try {
          // Simulate a raw em.flush() reaching the subscriber under an agent actor.
          subscriber.beforeCreate(fakeEventArgs('AnyDomainEntity'))
        } catch {
          threw = true
        }
      })
      // If a future change drops the agent-actor scope wiring or the subscriber's
      // throw, `threw` becomes false and this assertion fails — the invariant is
      // backstopped in CI.
      expect(threw).toBe(true)
    })
  })
})
