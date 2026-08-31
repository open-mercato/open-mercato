import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadFileAgentDir } from '../lib/sdk/defineFileAgent'

/**
 * Regression guard for spec 2026-07-11-agent-web-search-tool: file agents keep
 * exact OM tool ids. The Business Harness bundle maps those ids to connector
 * tools and never adds the retired submit_outcome tool.
 */
function makeAgentDir(files: { agentMd: string; outcome: string }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-agent-'))
  fs.writeFileSync(path.join(dir, 'AGENT.md'), files.agentMd, 'utf8')
  fs.writeFileSync(path.join(dir, 'OUTCOME.md'), files.outcome, 'utf8')
  return dir
}

const AGENT_MD = [
  '---',
  'id: deals.web_researcher',
  'label: Deal web researcher',
  'description: Research a company on the public web.',
  'tools: [agent_orchestrator.web_search, agent_orchestrator.web_fetch]',
  '---',
  'You research a company on the public web.',
].join('\n')

const OUTCOME = [
  '---',
  'kind: researcher',
  '---',
  '```json',
  JSON.stringify({
    type: 'object',
    required: ['summary'],
    properties: { summary: { type: 'string', minLength: 1 } },
  }),
  '```',
].join('\n')

describe('file-agent web egress tools', () => {
  const created: string[] = []

  afterAll(() => {
    for (const dir of created) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('keeps the exact web_search and web_fetch ids for the harness bundle', () => {
    const dir = makeAgentDir({ agentMd: AGENT_MD, outcome: OUTCOME })
    created.push(dir)
    const loaded = loadFileAgentDir(dir)
    expect(loaded).not.toBeNull()
    expect(loaded!.entry.runtime).toBe('business-harness')
    expect(loaded!.entry.tools).toEqual([
      'agent_orchestrator.web_search',
      'agent_orchestrator.web_fetch',
    ])
  })

  it('does not add submit_outcome to the file-agent tool contract', () => {
    const dir = makeAgentDir({ agentMd: AGENT_MD, outcome: OUTCOME })
    created.push(dir)
    const loaded = loadFileAgentDir(dir)
    expect(loaded).not.toBeNull()
    expect(loaded!.entry.resultKind).toBe('researcher')
    expect(loaded!.entry.tools).not.toContain('agent_orchestrator.submit_outcome')
  })
})
