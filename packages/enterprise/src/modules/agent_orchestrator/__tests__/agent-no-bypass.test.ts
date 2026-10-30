import type { EventArgs } from '@mikro-orm/core'
import {
  withAgentActor,
  withAuditedCommand,
  getAgentActorScope,
  isAuditedCommandActive,
  withRuntimeAuditWrite,
  isRuntimeAuditWriteActive,
} from '../lib/identity/agentWriteScope'
import {
  AgentKindNoBypassSubscriber,
  AgentWriteBypassError,
  isRuntimeAuditEntity,
} from '../lib/identity/agentNoBypassSubscriber'
import {
  AgentContextBundle,
  AgentEvalResult,
  AgentGuardrailCheck,
  AgentPrincipal,
  AgentProposal,
  AgentRun,
  AgentRunArtifact,
  AgentRunSession,
  AgentSpan,
  AgentToolCall,
} from '../data/entities'

const AGENT_USER = 'agent-user-1'
const HUMAN = 'human-1'

function fakeEventArgs(entityName = 'SomeEntity'): EventArgs<unknown> {
  return {
    entity: {},
    meta: { className: entityName },
  } as unknown as EventArgs<unknown>
}

type EntityClass = abstract new (...args: never[]) => object

function entityEventArgs(entityClass: EntityClass, changedFields?: Record<string, unknown>): EventArgs<unknown> {
  return {
    entity: Object.create(entityClass.prototype),
    meta: { className: entityClass.name, class: entityClass },
    ...(changedFields ? { changeSet: { payload: changedFields } } : {}),
  } as unknown as EventArgs<unknown>
}

const TRACE_RUN_UPDATE = {
  inputTokens: 70,
  outputTokens: 20,
  latencyMs: 120,
  model: 'test-model',
  updatedAt: new Date(),
}

const RUNTIME_AUDIT_CLASSES: EntityClass[] = [
  AgentGuardrailCheck,
  AgentContextBundle,
  AgentSpan,
  AgentToolCall,
  AgentEvalResult,
  AgentRunArtifact,
  AgentRunSession,
  AgentRun,
]

const NON_RUN_RUNTIME_AUDIT_CLASSES = RUNTIME_AUDIT_CLASSES.filter((entityClass) => entityClass !== AgentRun)

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

  describe('runtime-audit write scope (AO runtime-audit entity allowlist)', () => {
    const subscriber = new AgentKindNoBypassSubscriber()

    it('binds the runtime-audit scope and clears it after', async () => {
      expect(isRuntimeAuditWriteActive()).toBe(false)
      await withRuntimeAuditWrite(async () => {
        expect(isRuntimeAuditWriteActive()).toBe(true)
      })
      expect(isRuntimeAuditWriteActive()).toBe(false)
    })

    it('identifies allowlisted entities by class reference and rejects others', () => {
      for (const entityClass of RUNTIME_AUDIT_CLASSES) {
        expect(isRuntimeAuditEntity(entityEventArgs(entityClass))).toBe(true)
      }
      expect(isRuntimeAuditEntity(entityEventArgs(AgentProposal))).toBe(false)
      expect(isRuntimeAuditEntity(entityEventArgs(AgentPrincipal))).toBe(false)
      expect(isRuntimeAuditEntity(fakeEventArgs('SalesOrder'))).toBe(false)
    })

    it('does not match allowlisted entities by className alone', () => {
      expect(isRuntimeAuditEntity(fakeEventArgs('AgentSpan'))).toBe(false)
      expect(isRuntimeAuditEntity(fakeEventArgs('AgentRun'))).toBe(false)
    })

    it('lets allowlisted create/update/delete pass inside the scope under an agent actor', async () => {
      await withAgentActor({ agentUserId: AGENT_USER, onBehalfOfUserId: HUMAN }, async () => {
        await withRuntimeAuditWrite(async () => {
          for (const entityClass of NON_RUN_RUNTIME_AUDIT_CLASSES) {
            expect(() => subscriber.beforeCreate(entityEventArgs(entityClass))).not.toThrow()
            expect(() => subscriber.beforeUpdate(entityEventArgs(entityClass))).not.toThrow()
            expect(() => subscriber.beforeDelete(entityEventArgs(entityClass))).not.toThrow()
          }
        })
      })
    })

    it('lets an AgentRun update touching only trace/usage/eval fields pass inside the scope', async () => {
      await withAgentActor({ agentUserId: AGENT_USER, onBehalfOfUserId: HUMAN }, async () => {
        await withRuntimeAuditWrite(async () => {
          expect(() => subscriber.beforeUpdate(entityEventArgs(AgentRun, TRACE_RUN_UPDATE))).not.toThrow()
          const costAndEval = {
            costMinor: 12,
            currency: 'USD',
            evalScore: 1,
            evalPassed: true,
            goldenCaseId: null,
            goldenPassed: null,
          }
          expect(() => subscriber.beforeUpdate(entityEventArgs(AgentRun, costAndEval))).not.toThrow()
        })
      })
    })

    it('THROWS for an AgentRun create, delete or disposition/output update inside the scope', async () => {
      await withAgentActor({ agentUserId: AGENT_USER, onBehalfOfUserId: HUMAN }, async () => {
        await withRuntimeAuditWrite(async () => {
          expect(() => subscriber.beforeCreate(entityEventArgs(AgentRun, TRACE_RUN_UPDATE))).toThrow(AgentWriteBypassError)
          expect(() => subscriber.beforeDelete(entityEventArgs(AgentRun))).toThrow(AgentWriteBypassError)
          expect(() => subscriber.beforeUpdate(entityEventArgs(AgentRun))).toThrow(AgentWriteBypassError)
          for (const field of ['status', 'output', 'proposalId', 'agentId', 'confidence', 'completedAt']) {
            expect(() =>
              subscriber.beforeUpdate(entityEventArgs(AgentRun, { ...TRACE_RUN_UPDATE, [field]: 'tampered' })),
            ).toThrow(AgentWriteBypassError)
          }
        })
      })
    })

    it('still THROWS for a domain or non-allowlisted AO entity inside the scope', async () => {
      await withAgentActor({ agentUserId: AGENT_USER }, async () => {
        await withRuntimeAuditWrite(async () => {
          expect(() => subscriber.beforeCreate(fakeEventArgs('SalesOrder'))).toThrow(AgentWriteBypassError)
          expect(() => subscriber.beforeUpdate(fakeEventArgs('SalesOrder'))).toThrow(AgentWriteBypassError)
          expect(() => subscriber.beforeCreate(entityEventArgs(AgentProposal))).toThrow(AgentWriteBypassError)
          expect(() => subscriber.beforeUpdate(entityEventArgs(AgentPrincipal))).toThrow(AgentWriteBypassError)
        })
      })
    })

    it('fails a mixed flush (allowlisted + domain) on the domain entity', async () => {
      await withAgentActor({ agentUserId: AGENT_USER }, async () => {
        await withRuntimeAuditWrite(async () => {
          const flush = () => {
            subscriber.beforeCreate(entityEventArgs(AgentSpan))
            subscriber.beforeUpdate(entityEventArgs(AgentRun, TRACE_RUN_UPDATE))
            subscriber.beforeCreate(fakeEventArgs('SalesOrder'))
          }
          expect(flush).toThrow(AgentWriteBypassError)
          expect(flush).toThrow(/SalesOrder/)
        })
      })
    })

    it('keeps allowlisted entities failing closed OUTSIDE the scope under an agent actor', async () => {
      await withAgentActor({ agentUserId: AGENT_USER }, async () => {
        expect(() => subscriber.beforeCreate(entityEventArgs(AgentSpan))).toThrow(AgentWriteBypassError)
        expect(() => subscriber.beforeUpdate(entityEventArgs(AgentRun, TRACE_RUN_UPDATE))).toThrow(AgentWriteBypassError)
      })
    })

    it('has no effect without an agent actor (human path unchanged)', async () => {
      await withRuntimeAuditWrite(async () => {
        expect(() => subscriber.beforeCreate(fakeEventArgs('SalesOrder'))).not.toThrow()
        expect(() => subscriber.beforeCreate(entityEventArgs(AgentSpan))).not.toThrow()
      })
      expect(() => subscriber.beforeCreate(fakeEventArgs('SalesOrder'))).not.toThrow()
    })

    it('nests sensibly with the audited-command scope in both directions', async () => {
      await withAgentActor({ agentUserId: AGENT_USER }, async () => {
        await withRuntimeAuditWrite(async () => {
          await withAuditedCommand(async () => {
            expect(isRuntimeAuditWriteActive()).toBe(true)
            expect(isAuditedCommandActive()).toBe(true)
            expect(() => subscriber.beforeCreate(fakeEventArgs('SalesOrder'))).not.toThrow()
          })
          expect(isAuditedCommandActive()).toBe(false)
          expect(() => subscriber.beforeCreate(fakeEventArgs('SalesOrder'))).toThrow(AgentWriteBypassError)
        })
        await withAuditedCommand(async () => {
          await withRuntimeAuditWrite(async () => {
            expect(isRuntimeAuditWriteActive()).toBe(true)
            expect(isAuditedCommandActive()).toBe(true)
            expect(() => subscriber.beforeCreate(entityEventArgs(AgentProposal))).not.toThrow()
          })
          expect(isRuntimeAuditWriteActive()).toBe(false)
        })
        await withRuntimeAuditWrite(async () => {
          await withRuntimeAuditWrite(async () => {
            expect(isRuntimeAuditWriteActive()).toBe(true)
          })
          expect(isRuntimeAuditWriteActive()).toBe(true)
        })
        expect(isRuntimeAuditWriteActive()).toBe(false)
      })
    })
  })
})
