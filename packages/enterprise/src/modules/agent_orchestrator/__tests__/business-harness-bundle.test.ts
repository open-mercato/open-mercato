/** @jest-environment node */
// The execution bundle is the whole instruction set the harness acts on, and the
// harness validates it with `AgentExecutionBundleSchema` (strict). Compiling here
// and parsing there in one test is what keeps the two sides from drifting apart.
import { z } from 'zod'
import { AgentExecutionBundleSchema } from '@open-mercato/business-harness/contracts'
import type { AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { DELEGATE_TOOL_ID } from '../lib/sdk/defineAgent'
import { LOAD_SKILL_TOOL_ID, RUN_SKILL_SCRIPT_TOOL_ID, SUBMIT_OUTCOME_TOOL_ID } from '../ai-tools'
import {
  BUSINESS_HARNESS_CONNECTOR_ID,
  compileBusinessHarnessBundle,
  effectiveBusinessHarnessTools,
  prepareBusinessHarnessAgent,
} from '../lib/runtime/businessHarnessBundle'

const MODEL = {
  bindingId: 'om-model:openai:0123456789abcdef',
  bindingRevision: 'f'.repeat(64),
  driver: 'openai' as const,
  modelId: 'gpt-5-mini',
  credentialBindingId: 'om-env-provider:openai',
}

const LOOP = { maxSteps: 8, timeoutMs: 120_000, maxToolCalls: 40 }

function entry(overrides: Partial<AgentRegistryEntry> = {}): AgentRegistryEntry {
  return {
    id: 'deals.health_check',
    moduleId: 'agent_examples',
    resultKind: 'researcher',
    schema: z.object({ kind: z.literal('researcher'), data: z.object({ summary: z.string() }) }),
    tools: ['customers.search_deals', SUBMIT_OUTCOME_TOOL_ID],
    skills: [],
    subAgents: [],
    label: 'Deal health check',
    description: 'Reviews open deals.',
    instructions: 'Review the deals you are given.',
    runtime: 'business-harness',
    ...overrides,
  }
}

function compile(agent: AgentRegistryEntry) {
  return compileBusinessHarnessBundle({
    runId: '11111111-1111-4111-8111-111111111111',
    entry: agent,
    businessInput: { dealIds: ['deal-1'] },
    model: MODEL,
    runGrant: 'a-run-grant-token-value',
    loop: LOOP,
  })
}

describe('business harness bundle compiler', () => {
  it('produces a bundle the harness schema accepts', () => {
    const parsed = AgentExecutionBundleSchema.safeParse(compile(entry()).bundle)
    expect(parsed.success).toBe(true)
  })

  it('never exposes submit_outcome — the harness returns the result over NDJSON instead', () => {
    const { tools, bundle } = compile(entry())
    expect(tools).not.toContain(SUBMIT_OUTCOME_TOOL_ID)
    expect(bundle.agent.capabilities[0]!.allowedTools).not.toContain(SUBMIT_OUTCOME_TOOL_ID)
    expect(JSON.stringify(bundle)).not.toContain(SUBMIT_OUTCOME_TOOL_ID)
  })

  it('adds the skill and delegation tools only for agents that declared them', () => {
    expect(effectiveBusinessHarnessTools(entry())).toEqual(['customers.search_deals'])

    const withSkills = effectiveBusinessHarnessTools(entry({ skills: ['stage_playbook'] }))
    expect(withSkills).toContain(LOAD_SKILL_TOOL_ID)
    expect(withSkills).toContain(RUN_SKILL_SCRIPT_TOOL_ID)
    expect(withSkills).not.toContain(DELEGATE_TOOL_ID)

    const withSubAgents = effectiveBusinessHarnessTools(entry({ subAgents: ['revenue_estimator'] }))
    expect(withSubAgents).toContain(DELEGATE_TOOL_ID)
    expect(withSubAgents).not.toContain(LOAD_SKILL_TOOL_ID)
  })

  it('emits an exact, sorted, wildcard-free allowlist bound read-only to one connector', () => {
    const { bundle } = compile(entry({ skills: ['stage_playbook'], subAgents: ['revenue_estimator'] }))
    const capability = bundle.agent.capabilities[0]!

    expect(bundle.agent.capabilities).toHaveLength(1)
    expect(capability.connectorId).toBe(BUSINESS_HARNESS_CONNECTOR_ID)
    expect(capability.access).toBe('read')
    expect(capability.allowedTools).not.toContain('*')
    expect([...capability.allowedTools].sort()).toEqual(capability.allowedTools)
    expect(new Set(capability.allowedTools).size).toBe(capability.allowedTools.length)
  })

  it('binds no capability at all when the agent declares no tools', () => {
    const { bundle } = compile(entry({ tools: [SUBMIT_OUTCOME_TOOL_ID] }))
    expect(bundle.agent.capabilities).toEqual([])
    expect(AgentExecutionBundleSchema.safeParse(bundle).success).toBe(true)
  })

  it('digests the agent definition deterministically and notices a changed definition', () => {
    const first = prepareBusinessHarnessAgent(entry())
    const second = prepareBusinessHarnessAgent(entry())
    expect(first.digest).toBe(second.digest)
    expect(first.version).toBe(first.digest.slice(0, 16))

    expect(prepareBusinessHarnessAgent(entry({ instructions: 'Do something else.' })).digest).not.toBe(
      first.digest,
    )
    expect(prepareBusinessHarnessAgent(entry({ tools: ['customers.search_people'] })).digest).not.toBe(
      first.digest,
    )
  })

  it('excludes the run grant and the model credential binding from the digest', () => {
    // The digest identifies the AGENT, so rotating a credential or reissuing a grant
    // must not look like a different agent to the identity assertion on the result.
    const prepared = prepareBusinessHarnessAgent(entry())
    const withOtherGrant = compileBusinessHarnessBundle({
      runId: '22222222-2222-4222-8222-222222222222',
      entry: entry(),
      businessInput: {},
      model: { ...MODEL, credentialBindingId: 'om-env-provider:anthropic' },
      runGrant: 'a-completely-different-grant',
      loop: LOOP,
    })
    expect(withOtherGrant.digest).toBe(prepared.digest)
  })

  it('carries the full output schema in object mode and the grant under authorization', () => {
    const { bundle } = compile(entry())
    expect(bundle.agent.output.mode).toBe('object')
    expect(bundle.agent.output).toHaveProperty('schema.properties.kind')
    expect(bundle.authorization.runGrant).toBe('a-run-grant-token-value')
    expect(bundle.input.prompt).toBe(JSON.stringify({ dealIds: ['deal-1'] }))
  })
})
