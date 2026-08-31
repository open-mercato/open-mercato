import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadFileAgentDir } from '../lib/sdk/defineFileAgent'

function makeAgentDir(files: { agentMd?: string; outcome?: string }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-agent-'))
  if (files.agentMd !== undefined) fs.writeFileSync(path.join(dir, 'AGENT.md'), files.agentMd, 'utf8')
  if (files.outcome !== undefined) fs.writeFileSync(path.join(dir, 'OUTCOME.md'), files.outcome, 'utf8')
  return dir
}

/** Add a `sub-agents/<name>/{AGENT.md,OUTCOME.md}` dir under an existing agent dir. */
function addSubAgent(
  agentDir: string,
  name: string,
  files: { agentMd: string; outcome: string },
): void {
  const subDir = path.join(agentDir, 'sub-agents', name)
  fs.mkdirSync(subDir, { recursive: true })
  fs.writeFileSync(path.join(subDir, 'AGENT.md'), files.agentMd, 'utf8')
  fs.writeFileSync(path.join(subDir, 'OUTCOME.md'), files.outcome, 'utf8')
}

const SUB_AGENT_MD = [
  '---',
  'id: deals.activity_scan',
  'label: Activity scan',
  'description: Scan recent deal activity.',
  '---',
  'You scan activity.',
].join('\n')

const SUB_OUTCOME_RESEARCHER = [
  '---',
  'kind: researcher',
  '---',
  '```json',
  JSON.stringify({
    type: 'object',
    required: ['momentum'],
    properties: { momentum: { type: 'string', minLength: 1 } },
  }),
  '```',
].join('\n')

const VALID_AGENT_MD = [
  '---',
  'id: deals.health_check',
  'label: Deal health check',
  'description: Assess a deal and propose the next stage.',
  'provider: anthropic',
  'model: claude-sonnet-4-6',
  'maxSteps: 12',
  '---',
  'You assess the health of a sales deal.',
].join('\n')

const AGENT_WITH_SUB_AGENT_MD = VALID_AGENT_MD.replace(
  'maxSteps: 12',
  'maxSteps: 12\nsubAgents: [deals.activity_scan]',
)

const VALID_OUTCOME = [
  '---',
  'kind: proposal',
  '---',
  '```json',
  JSON.stringify({
    type: 'object',
    additionalProperties: false,
    required: ['confidence', 'rationale'],
    properties: {
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      rationale: { type: 'string', minLength: 1 },
    },
  }),
  '```',
  'Return a proposal.',
].join('\n')

describe('loadFileAgentDir', () => {
  const created: string[] = []
  afterAll(() => {
    for (const dir of created) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('loads a valid agent into a Business Harness entry with the compiled schema', () => {
    const dir = makeAgentDir({ agentMd: VALID_AGENT_MD, outcome: VALID_OUTCOME })
    created.push(dir)
    const loaded = loadFileAgentDir(dir)
    expect(loaded).not.toBeNull()
    expect(loaded!.entry.runtime).toBe('business-harness')
    expect(loaded!.entry.id).toBe('deals.health_check')
    expect(loaded!.entry.resultKind).toBe('proposal')
    expect(loaded!.entry.loop).toEqual({ maxSteps: 12 })
    expect(loaded!.entry.defaultProvider).toBe('anthropic')
    expect(loaded!.entry.instructions).toBe('You assess the health of a sales deal.')
    expect(loaded!.entry.tools).toEqual([])

    // schema validates the proposal envelope
    expect(
      loaded!.entry.schema.safeParse({
        kind: 'proposal',
        proposal: { confidence: 0.7, rationale: 'looks good' },
      }).success,
    ).toBe(true)
    expect(loaded!.entry.schema.safeParse({ kind: 'researcher', data: {} }).success).toBe(false)

  })

  it('reads an optional SAMPLE.json into entry.sampleInput (and ignores a malformed one)', () => {
    const good = makeAgentDir({ agentMd: VALID_AGENT_MD, outcome: VALID_OUTCOME })
    fs.writeFileSync(
      path.join(good, 'SAMPLE.json'),
      JSON.stringify({ deal: { id: 'demo-deal-1', stage: 'Proposal' } }),
      'utf8',
    )
    created.push(good)
    expect(loadFileAgentDir(good)!.entry.sampleInput).toEqual({
      deal: { id: 'demo-deal-1', stage: 'Proposal' },
    })

    // No SAMPLE.json → undefined.
    const none = makeAgentDir({ agentMd: VALID_AGENT_MD, outcome: VALID_OUTCOME })
    created.push(none)
    expect(loadFileAgentDir(none)!.entry.sampleInput).toBeUndefined()

    // Malformed SAMPLE.json never blocks loading — the sample is just dropped.
    const bad = makeAgentDir({ agentMd: VALID_AGENT_MD, outcome: VALID_OUTCOME })
    fs.writeFileSync(path.join(bad, 'SAMPLE.json'), '{ not valid', 'utf8')
    created.push(bad)
    const loadedBad = loadFileAgentDir(bad)
    expect(loadedBad).not.toBeNull()
    expect(loadedBad!.entry.sampleInput).toBeUndefined()
  })

  it('returns null when AGENT.md or OUTCOME.md is missing', () => {
    const onlyAgentMd = makeAgentDir({ agentMd: VALID_AGENT_MD })
    const onlyOutcome = makeAgentDir({ outcome: VALID_OUTCOME })
    created.push(onlyAgentMd, onlyOutcome)
    expect(loadFileAgentDir(onlyAgentMd)).toBeNull()
    expect(loadFileAgentDir(onlyOutcome)).toBeNull()
  })

  it('returns null on malformed AGENT.md (missing required) or OUTCOME.md (no JSON block)', () => {
    const badClaude = makeAgentDir({
      agentMd: ['---', 'label: No Id', 'description: d', '---', 'body'].join('\n'),
      outcome: VALID_OUTCOME,
    })
    const badOutcome = makeAgentDir({
      agentMd: VALID_AGENT_MD,
      outcome: ['---', 'kind: proposal', '---', 'no json block here'].join('\n'),
    })
    created.push(badClaude, badOutcome)
    expect(loadFileAgentDir(badClaude)).toBeNull()
    expect(loadFileAgentDir(badOutcome)).toBeNull()
  })

  // Phase 4 — sub-agents.
  it('loads declared researcher sub-agents for Business Harness delegation', () => {
    const dir = makeAgentDir({ agentMd: AGENT_WITH_SUB_AGENT_MD, outcome: VALID_OUTCOME })
    created.push(dir)
    addSubAgent(dir, 'activity_scan', { agentMd: SUB_AGENT_MD, outcome: SUB_OUTCOME_RESEARCHER })

    const loaded = loadFileAgentDir(dir)
    expect(loaded).not.toBeNull()
    expect(loaded!.subAgents).toHaveLength(1)
    const sub = loaded!.subAgents[0]
    expect(sub.entry.id).toBe('deals.activity_scan')
    expect(sub.resultKind).toBe('researcher')
    expect(sub.entry.runtime).toBe('business-harness')
    expect(sub.entry.subAgents).toEqual([])
    expect(loaded!.entry.subAgents).toEqual(['deals.activity_scan'])
  })

  it('rejects a proposal sub-agent (only the primary proposes)', () => {
    const dir = makeAgentDir({ agentMd: VALID_AGENT_MD, outcome: VALID_OUTCOME })
    created.push(dir)
    addSubAgent(dir, 'bad', { agentMd: SUB_AGENT_MD, outcome: VALID_OUTCOME })
    expect(() => loadFileAgentDir(dir)).toThrow(/researcher/i)
  })

  it('rejects a sub-agent that declares its own subAgents (depth cap = 1)', () => {
    const dir = makeAgentDir({ agentMd: VALID_AGENT_MD, outcome: VALID_OUTCOME })
    created.push(dir)
    addSubAgent(dir, 'nested', {
      agentMd: [
        '---',
        'id: deals.nested',
        'label: Nested',
        'description: Nested sub-agent.',
        'subAgents: [deals.deeper]',
        '---',
        'body',
      ].join('\n'),
      outcome: SUB_OUTCOME_RESEARCHER,
    })
    expect(() => loadFileAgentDir(dir)).toThrow(/depth cap/i)
  })
})
