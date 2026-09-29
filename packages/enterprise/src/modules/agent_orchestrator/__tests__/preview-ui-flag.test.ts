/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'

const FLAG = 'NEXT_PUBLIC_OM_AGENT_ORCHESTRATOR_PREVIEW_UI'
const SERVER_FLAG = 'OM_AGENT_ORCHESTRATOR_PREVIEW_UI'

async function loadFlag() {
  jest.resetModules()
  return (await import('../lib/featureFlags')).isAgentPreviewUiEnabled
}

describe('agent cockpit preview-UI flag', () => {
  const original = { public: process.env[FLAG], server: process.env[SERVER_FLAG] }

  afterEach(() => {
    if (original.public === undefined) delete process.env[FLAG]
    else process.env[FLAG] = original.public
    if (original.server === undefined) delete process.env[SERVER_FLAG]
    else process.env[SERVER_FLAG] = original.server
  })

  it('is off when unset — an unconfigured deployment never shows a dead control', async () => {
    delete process.env[FLAG]
    delete process.env[SERVER_FLAG]
    expect((await loadFlag())()).toBe(false)
  })

  it('is on for any truthy token', async () => {
    delete process.env[SERVER_FLAG]
    for (const token of ['1', 'true', 'yes', 'on']) {
      process.env[FLAG] = token
      expect((await loadFlag())()).toBe(true)
    }
  })

  it('falls back to the server-only twin for non-client call sites', async () => {
    delete process.env[FLAG]
    process.env[SERVER_FLAG] = 'true'
    expect((await loadFlag())()).toBe(true)
  })

  it('stays off for an unparseable value rather than guessing', async () => {
    delete process.env[SERVER_FLAG]
    process.env[FLAG] = 'maybe'
    expect((await loadFlag())()).toBe(false)
  })
})

// The flag is only worth anything if every surface it is supposed to hide
// actually reads it. Asserting on the sources keeps a later edit from quietly
// reintroducing an ungated dead button.
describe('preview-only surfaces are gated', () => {
  const moduleRoot = path.resolve(__dirname, '..')
  const read = (rel: string) => fs.readFileSync(path.join(moduleRoot, rel), 'utf8')
  const gatedFiles = [
    'backend/agents/page.tsx',
    'backend/agents/[id]/page.tsx',
    'backend/agents/[id]/components/AgentHeaderCard.tsx',
    'backend/processes/[id]/page.tsx',
    'backend/overview/page.tsx',
    'backend/traces/[id]/page.tsx',
    'backend/caseload/page.tsx',
  ]

  it.each(gatedFiles)('%s reads the preview flag', (rel) => {
    expect(read(rel)).toContain('isAgentPreviewUiEnabled')
  })

  it('the registry list no longer ships a Filters button with no handler', () => {
    const source = read('backend/agents/page.tsx')
    expect(source).not.toContain('agent_orchestrator.agents.actions.filters')
    expect(source).toContain('onFiltersApply')
  })
})
