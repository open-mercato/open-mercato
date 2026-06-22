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

const SUB_OUTCOME_INFORMATIVE = [
  '---',
  'kind: informative',
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

const VALID_OUTCOME = [
  '---',
  'kind: actionable',
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

  it('loads a valid agent into an opencode entry with the compiled schema', () => {
    const dir = makeAgentDir({ agentMd: VALID_AGENT_MD, outcome: VALID_OUTCOME })
    created.push(dir)
    const loaded = loadFileAgentDir(dir)
    expect(loaded).not.toBeNull()
    expect(loaded!.entry.runtime).toBe('opencode')
    expect(loaded!.entry.id).toBe('deals.health_check')
    expect(loaded!.entry.resultKind).toBe('actionable')
    expect(loaded!.openCodeAgentName).toBe('deals_health_check')
    expect(loaded!.entry.loop).toEqual({ maxSteps: 12 })
    expect(loaded!.entry.defaultProvider).toBe('anthropic')

    // schema validates the actionable envelope
    expect(
      loaded!.entry.schema.safeParse({
        kind: 'actionable',
        proposal: { confidence: 0.7, rationale: 'looks good' },
      }).success,
    ).toBe(true)
    expect(loaded!.entry.schema.safeParse({ kind: 'informative', data: {} }).success).toBe(false)

    // rendered OpenCode agent file carries the propose-only allowlist + submit_outcome
    expect(loaded!.openCodeAgentFile).toContain('mode: primary')
    expect(loaded!.openCodeAgentFile).toContain('"*": false')
    expect(loaded!.openCodeAgentFile).toContain('open-mercato_agent_orchestrator_submit_outcome')
    expect(loaded!.openCodeAgentFile).toContain('write: deny')
    expect(loaded!.openCodeAgentFile).toContain('submit_outcome')
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
      outcome: ['---', 'kind: actionable', '---', 'no json block here'].join('\n'),
    })
    created.push(badClaude, badOutcome)
    expect(loadFileAgentDir(badClaude)).toBeNull()
    expect(loadFileAgentDir(badOutcome)).toBeNull()
  })

  // Phase 4 — sub-agents.
  it('loads sub-agents, renders them mode: subagent + read-only, and wires the primary task allowance', () => {
    const dir = makeAgentDir({ agentMd: VALID_AGENT_MD, outcome: VALID_OUTCOME })
    created.push(dir)
    addSubAgent(dir, 'activity_scan', { agentMd: SUB_AGENT_MD, outcome: SUB_OUTCOME_INFORMATIVE })

    const loaded = loadFileAgentDir(dir)
    expect(loaded).not.toBeNull()
    expect(loaded!.subAgents).toHaveLength(1)
    const sub = loaded!.subAgents[0]
    expect(sub.entry.id).toBe('deals.activity_scan')
    expect(sub.resultKind).toBe('informative')
    expect(sub.openCodeAgentName).toBe('deals_activity_scan')

    // Sub-agent file: mode subagent, read-only, NO further delegation (task deny).
    expect(sub.openCodeAgentFile).toContain('mode: subagent')
    expect(sub.openCodeAgentFile).toContain('write: deny')
    expect(sub.openCodeAgentFile).toContain('task: deny')
    expect(sub.openCodeAgentFile).not.toContain('"task": true')

    // Primary allows the task tool and whitelists ONLY its sub-agent's name.
    expect(loaded!.openCodeAgentFile).toContain('mode: primary')
    expect(loaded!.openCodeAgentFile).toContain('"task": true')
    expect(loaded!.openCodeAgentFile).toContain('"deals_activity_scan": allow')
    expect(loaded!.openCodeAgentFile).toContain('## Sub-agents')
  })

  it('rejects an actionable sub-agent (only the primary proposes)', () => {
    const dir = makeAgentDir({ agentMd: VALID_AGENT_MD, outcome: VALID_OUTCOME })
    created.push(dir)
    addSubAgent(dir, 'bad', { agentMd: SUB_AGENT_MD, outcome: VALID_OUTCOME })
    expect(() => loadFileAgentDir(dir)).toThrow(/informative/i)
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
      outcome: SUB_OUTCOME_INFORMATIVE,
    })
    expect(() => loadFileAgentDir(dir)).toThrow(/depth cap/i)
  })
})
