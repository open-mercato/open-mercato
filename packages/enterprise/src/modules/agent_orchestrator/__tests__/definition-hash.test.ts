import { z } from 'zod'
import { defineAgent, getAgentEntry, type AgentRegistryEntry } from '../lib/sdk/defineAgent'
import {
  computeCodeAgentDefinitionHash,
  computeFileAgentDefinitionHash,
  resolveAgentDefinitionHash,
  resolveRunAgentVersion,
  toShortAgentVersion,
  type DefinitionHashSourceFile,
} from '../lib/trace/definitionHash'
import { createRun } from '../lib/runtime/persistence'

const FULL_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/
const SHORT_VERSION_PATTERN = /^sha256:[0-9a-f]{16}$/

const proposalSchema = z.object({
  kind: z.literal('proposal'),
  proposal: z.object({ confidence: z.number() }),
})

type CodeAgentVariant = {
  id: string
  instructions?: string
  kind?: 'proposal' | 'research'
  schema?: z.ZodTypeAny
}

function defineVariant(variant: CodeAgentVariant): AgentRegistryEntry {
  const kind = variant.kind ?? 'proposal'
  defineAgent({
    id: variant.id,
    moduleId: 'definition_hash_tests',
    label: 'Hash test agent',
    description: 'Agent used by the definition hash tests.',
    instructions: variant.instructions ?? 'Assess the deal.',
    result: { kind, schema: variant.schema ?? proposalSchema },
  })
  const entry = getAgentEntry(variant.id)
  if (!entry) throw new Error('[internal] agent not registered')
  return entry
}

const sourceFiles: DefinitionHashSourceFile[] = [
  { path: 'OUTCOME.md', content: 'kind: proposal', inContext: true },
  { path: 'AGENT.md', content: 'You assess a deal.', inContext: true },
  { path: 'SAMPLE.json', content: '{"dealId":"one"}', inContext: false },
]

describe('code agent definition hash', () => {
  it('is stable across key order of the hashed fields', () => {
    const first = computeCodeAgentDefinitionHash({
      aiDefinitionHash: 'sha256:abc',
      resultKind: 'proposal',
      outcomeSchema: { type: 'object', properties: { score: { type: 'number' }, note: { type: 'string' } } },
      agentType: 'decision_maker',
    })
    const second = computeCodeAgentDefinitionHash({
      agentType: 'decision_maker',
      outcomeSchema: { properties: { note: { type: 'string' }, score: { type: 'number' } }, type: 'object' },
      resultKind: 'proposal',
      aiDefinitionHash: 'sha256:abc',
    })
    expect(first).toMatch(FULL_HASH_PATTERN)
    expect(second).toBe(first)
  })

  it('combines the ai-assistant definition hash with resultKind and the outcome schema', () => {
    const base = resolveAgentDefinitionHash(defineVariant({ id: 'definition_hash_tests.base' }))
    const otherPrompt = resolveAgentDefinitionHash(
      defineVariant({ id: 'definition_hash_tests.prompt', instructions: 'Assess the order.' }),
    )
    const otherKind = resolveAgentDefinitionHash(
      defineVariant({
        id: 'definition_hash_tests.kind',
        kind: 'research',
        schema: z.object({ kind: z.literal('research'), data: z.object({ confidence: z.number() }) }),
      }),
    )
    const otherSchema = resolveAgentDefinitionHash(
      defineVariant({
        id: 'definition_hash_tests.schema',
        schema: z.object({ kind: z.literal('proposal'), proposal: z.object({ confidence: z.string() }) }),
      }),
    )
    expect(base).toMatch(FULL_HASH_PATTERN)
    expect(getAgentEntry('definition_hash_tests.base')?.aiDefinitionHash).toMatch(FULL_HASH_PATTERN)
    expect(new Set([base, otherPrompt, otherKind, otherSchema]).size).toBe(4)
  })

  it('changes when the outcome schema or result kind changes for the same ai definition', () => {
    const reference = computeCodeAgentDefinitionHash({
      aiDefinitionHash: 'sha256:abc',
      resultKind: 'proposal',
      outcomeSchema: { type: 'object' },
      agentType: null,
    })
    expect(
      computeCodeAgentDefinitionHash({
        aiDefinitionHash: 'sha256:abc',
        resultKind: 'research',
        outcomeSchema: { type: 'object' },
        agentType: null,
      }),
    ).not.toBe(reference)
    expect(
      computeCodeAgentDefinitionHash({
        aiDefinitionHash: 'sha256:abc',
        resultKind: 'proposal',
        outcomeSchema: { type: 'array' },
        agentType: null,
      }),
    ).not.toBe(reference)
    expect(
      computeCodeAgentDefinitionHash({
        aiDefinitionHash: 'sha256:def',
        resultKind: 'proposal',
        outcomeSchema: { type: 'object' },
        agentType: null,
      }),
    ).not.toBe(reference)
  })
})

describe('file agent definition hash', () => {
  it('ignores files that are not in context', () => {
    const reference = computeFileAgentDefinitionHash(sourceFiles)
    const withChangedSample = computeFileAgentDefinitionHash([
      ...sourceFiles.filter((file) => file.inContext),
      { path: 'SAMPLE.json', content: '{"dealId":"two"}', inContext: false },
      { path: 'FACTS.json', content: '[]', inContext: false },
    ])
    expect(reference).toMatch(FULL_HASH_PATTERN)
    expect(withChangedSample).toBe(reference)
  })

  it('is independent of file order and changes with in-context content', () => {
    const reference = computeFileAgentDefinitionHash(sourceFiles)
    expect(computeFileAgentDefinitionHash([...sourceFiles].reverse())).toBe(reference)
    expect(
      computeFileAgentDefinitionHash([
        { path: 'AGENT.md', content: 'You assess an order.', inContext: true },
        ...sourceFiles.filter((file) => file.path !== 'AGENT.md'),
      ]),
    ).not.toBe(reference)
  })

  it('is computed at load time from the registry entry source files', () => {
    const entry: AgentRegistryEntry = {
      id: 'definition_hash_tests.file',
      moduleId: 'definition_hash_tests',
      resultKind: 'research',
      schema: z.object({ kind: z.literal('research'), data: z.unknown() }),
      tools: [],
      skills: [],
      subAgents: [],
      label: 'File agent',
      description: 'File agent.',
      instructions: 'inform',
      runtime: 'opencode',
      sourceFiles: sourceFiles.map((file) => ({ ...file, tokens: 1 })),
    }
    const resolved = resolveAgentDefinitionHash(entry)
    expect(resolved).toMatch(FULL_HASH_PATTERN)
    expect(resolved).toBe(computeFileAgentDefinitionHash(sourceFiles))
    expect(resolveAgentDefinitionHash({ ...entry, sourceFiles: [...(entry.sourceFiles ?? [])].reverse() })).toBe(
      resolved,
    )
  })
})

describe('run agent version stamping', () => {
  function captureCreateRunInput(): {
    commandBus: unknown
    captured: () => Record<string, unknown> | undefined
  } {
    let captured: Record<string, unknown> | undefined
    const commandBus = {
      async execute<Input, Output>(id: string, opts: { input: Input }): Promise<{ result: Output }> {
        if (id === 'agent_orchestrator.runs.create') {
          captured = opts.input as Record<string, unknown>
          return { result: { runId: 'run-1' } as unknown as Output }
        }
        return { result: {} as unknown as Output }
      },
    }
    return { commandBus, captured: () => captured }
  }

  const definitionHash = computeFileAgentDefinitionHash(sourceFiles)

  it('shortens a definition hash to sha256 plus 16 hex characters', () => {
    const shortVersion = toShortAgentVersion(definitionHash)
    expect(shortVersion).toMatch(SHORT_VERSION_PATTERN)
    expect(definitionHash.startsWith(shortVersion)).toBe(true)
    expect(resolveRunAgentVersion({})).toBeNull()
  })

  it('stamps the short definition hash version when no explicit version is set', async () => {
    const harness = captureCreateRunInput()
    await createRun(harness.commandBus as never, {} as never, {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      agentId: 'definition_hash_tests.file',
      input: {},
      definitionHash,
    })
    const input = harness.captured()
    expect(input?.agentVersion).toBe(toShortAgentVersion(definitionHash))
    expect(input?.agentVersion).toMatch(SHORT_VERSION_PATTERN)
    expect(input).not.toHaveProperty('definitionHash')
  })

  it('keeps an explicit agent version', async () => {
    const harness = captureCreateRunInput()
    await createRun(harness.commandBus as never, {} as never, {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      agentId: 'definition_hash_tests.file',
      input: {},
      agentVersion: '7',
      definitionHash,
    })
    expect(harness.captured()?.agentVersion).toBe('7')
  })

  it('leaves the version empty when neither is known', async () => {
    const harness = captureCreateRunInput()
    await createRun(harness.commandBus as never, {} as never, {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      agentId: 'definition_hash_tests.file',
      input: {},
    })
    expect(harness.captured()?.agentVersion).toBeNull()
  })
})
