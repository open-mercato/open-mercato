import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadFileAgentDir } from '../lib/sdk/defineFileAgent'

function makeAgentDir(files: { claude?: string; outcome?: string }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-agent-'))
  if (files.claude !== undefined) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), files.claude, 'utf8')
  if (files.outcome !== undefined) fs.writeFileSync(path.join(dir, 'OUTCOME.md'), files.outcome, 'utf8')
  return dir
}

const VALID_CLAUDE = [
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
    const dir = makeAgentDir({ claude: VALID_CLAUDE, outcome: VALID_OUTCOME })
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
    expect(loaded!.openCodeAgentFile).toContain('agent_orchestrator.submit_outcome')
    expect(loaded!.openCodeAgentFile).toContain('write: deny')
    expect(loaded!.openCodeAgentFile).toContain('submit_outcome')
  })

  it('returns null when CLAUDE.md or OUTCOME.md is missing', () => {
    const onlyClaude = makeAgentDir({ claude: VALID_CLAUDE })
    const onlyOutcome = makeAgentDir({ outcome: VALID_OUTCOME })
    created.push(onlyClaude, onlyOutcome)
    expect(loadFileAgentDir(onlyClaude)).toBeNull()
    expect(loadFileAgentDir(onlyOutcome)).toBeNull()
  })

  it('returns null on malformed CLAUDE.md (missing required) or OUTCOME.md (no JSON block)', () => {
    const badClaude = makeAgentDir({
      claude: ['---', 'label: No Id', 'description: d', '---', 'body'].join('\n'),
      outcome: VALID_OUTCOME,
    })
    const badOutcome = makeAgentDir({
      claude: VALID_CLAUDE,
      outcome: ['---', 'kind: actionable', '---', 'no json block here'].join('\n'),
    })
    created.push(badClaude, badOutcome)
    expect(loadFileAgentDir(badClaude)).toBeNull()
    expect(loadFileAgentDir(badOutcome)).toBeNull()
  })
})
