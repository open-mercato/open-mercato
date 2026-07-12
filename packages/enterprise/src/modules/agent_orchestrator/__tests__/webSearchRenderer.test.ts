import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadFileAgentDir } from '../lib/sdk/defineFileAgent'

/**
 * Regression guard for spec 2026-07-11-agent-web-search-tool, Phase 3 step 9:
 * the file-agent renderer must emit the new `web_search`/`web_fetch` MCP tool ids
 * into an opting-in agent's allowlist WITH NO renderer change — they are ordinary
 * `open-mercato_agent_orchestrator_*` ids that ride the existing allowlist union.
 * Also pins that the propose-only frontmatter (deny-by-default + write/edit/bash
 * denies) is unchanged, so adding web tools never relaxed the gate.
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
  'kind: informative',
  '---',
  '```json',
  JSON.stringify({
    type: 'object',
    required: ['summary'],
    properties: { summary: { type: 'string', minLength: 1 } },
  }),
  '```',
].join('\n')

describe('file-agent renderer — web egress tools', () => {
  it('emits the web_search/web_fetch MCP ids in the allowlist with no renderer change', () => {
    const dir = makeAgentDir({ agentMd: AGENT_MD, outcome: OUTCOME })
    const loaded = loadFileAgentDir(dir)
    expect(loaded).not.toBeNull()
    const file = loaded!.openCodeAgentFile
    expect(file).toContain('"open-mercato_agent_orchestrator_web_search": true')
    expect(file).toContain('"open-mercato_agent_orchestrator_web_fetch": true')
  })

  it('keeps the propose-only frontmatter intact when web tools are declared', () => {
    const dir = makeAgentDir({ agentMd: AGENT_MD, outcome: OUTCOME })
    const file = loadFileAgentDir(dir)!.openCodeAgentFile
    // Core tools still present + deny-by-default + write/edit/bash denies unchanged.
    expect(file).toContain('"open-mercato_agent_orchestrator_submit_outcome": true')
    expect(file).toContain('"*": false')
    expect(file).toContain('write: deny')
    expect(file).toContain('edit: deny')
    expect(file).toContain('bash: deny')
  })
})
