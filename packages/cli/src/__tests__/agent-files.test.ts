import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAgentFilesExtension } from '../lib/generators/extensions/agent-files'
import type { ModuleScanContext } from '../lib/generators/extension'

/**
 * Build a throwaway repo root carrying the package sentinels used to locate the
 * repo, plus a module `agents/` tree under the app base.
 */
function makeRepo(): {
  root: string
  appBase: string
  pkgBase: string
  manifestPath: string
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-files-repo-'))
  fs.writeFileSync(path.join(root, 'package.json'), '{}', 'utf8')
  fs.mkdirSync(path.join(root, 'packages', 'enterprise'), { recursive: true })
  const appBase = path.join(root, 'apps', 'mercato', 'src', 'modules', 'agent_examples')
  const pkgBase = path.join(root, 'packages', 'core', 'src', 'modules', '__none__')
  fs.mkdirSync(appBase, { recursive: true })
  fs.mkdirSync(pkgBase, { recursive: true })
  return {
    root,
    appBase,
    pkgBase,
    manifestPath: path.join(
      root,
      'packages',
      'enterprise',
      'src',
      'modules',
      'agent_orchestrator',
      'generated',
      'file-agents.generated.ts',
    ),
  }
}

function writeAgent(
  agentDir: string,
  files: { claude: string; outcome: string },
): void {
  fs.mkdirSync(agentDir, { recursive: true })
  fs.writeFileSync(path.join(agentDir, 'AGENT.md'), files.claude, 'utf8')
  fs.writeFileSync(path.join(agentDir, 'OUTCOME.md'), files.outcome, 'utf8')
}

const PRIMARY_CLAUDE = [
  '---',
  'id: deals.health_check',
  'label: Deal health check',
  'description: Assess a deal and propose the next stage.',
  'subAgents: [deals.activity_scan]',
  '---',
  'You assess deal health.',
].join('\n')

const PRIMARY_OUTCOME = [
  '---',
  'kind: proposal',
  '---',
  '```json',
  JSON.stringify({
    type: 'object',
    required: ['rationale'],
    properties: { rationale: { type: 'string', minLength: 1 } },
  }),
  '```',
].join('\n')

const SUB_CLAUDE = [
  '---',
  'id: deals.activity_scan',
  'label: Activity scan',
  'description: Scan recent deal activity.',
  '---',
  'You scan activity.',
].join('\n')

const SUB_OUTCOME = [
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

function makeCtx(repo: ReturnType<typeof makeRepo>, moduleId: string): ModuleScanContext {
  return {
    moduleId,
    roots: { appBase: repo.appBase, pkgBase: repo.pkgBase },
    imps: {} as ModuleScanContext['imps'],
    importIdRef: { value: 0 },
    sharedImports: [],
    resolveModuleFile: (() => null) as unknown as ModuleScanContext['resolveModuleFile'],
    resolveFirstModuleFile: (() => null) as unknown as ModuleScanContext['resolveFirstModuleFile'],
    processStandaloneConfig: () => null,
    sanitizeGeneratedModuleSpecifier: (importPath: string) => importPath,
  }
}

describe('agent-files generator (Phase 4 sub-agents)', () => {
  const created: string[] = []
  afterAll(() => {
    for (const root of created) fs.rmSync(root, { recursive: true, force: true })
  })

  it('nests the sub-agent in the manifest without runtime-specific files', () => {
    const repo = makeRepo()
    created.push(repo.root)
    const agentDir = path.join(repo.appBase, 'agents', 'deals_health_check')
    writeAgent(agentDir, { claude: PRIMARY_CLAUDE, outcome: PRIMARY_OUTCOME })
    writeAgent(path.join(agentDir, 'sub-agents', 'activity_scan'), {
      claude: SUB_CLAUDE,
      outcome: SUB_OUTCOME,
    })

    const extension = createAgentFilesExtension()
    extension.scanModule(makeCtx(repo, 'agent_examples'))
    extension.generateOutput()

    // Manifest carries the sub-agent as a nested descriptor.
    const manifest = fs.readFileSync(repo.manifestPath, 'utf8')
    expect(manifest).toContain('deals.health_check')
    expect(manifest).toContain('subAgentDescriptors')
    expect(manifest).toContain('deals.activity_scan')
    expect(manifest).not.toContain('openCodeAgentName')
    expect(fs.existsSync(path.join(repo.root, 'docker'))).toBe(false)
  })

  it('fails generation when a sub-agent is proposal (only the primary proposes)', () => {
    const repo = makeRepo()
    created.push(repo.root)
    const agentDir = path.join(repo.appBase, 'agents', 'deals_health_check')
    writeAgent(agentDir, { claude: PRIMARY_CLAUDE, outcome: PRIMARY_OUTCOME })
    writeAgent(path.join(agentDir, 'sub-agents', 'bad'), {
      claude: SUB_CLAUDE,
      // proposal sub-agent — must be rejected
      outcome: PRIMARY_OUTCOME,
    })

    const extension = createAgentFilesExtension()
    expect(() => extension.scanModule(makeCtx(repo, 'agent_examples'))).toThrow(/researcher/i)
  })

  it('fails generation when a sub-agent declares its own subAgents (depth cap = 1)', () => {
    const repo = makeRepo()
    created.push(repo.root)
    const agentDir = path.join(repo.appBase, 'agents', 'deals_health_check')
    writeAgent(agentDir, { claude: PRIMARY_CLAUDE, outcome: PRIMARY_OUTCOME })
    writeAgent(path.join(agentDir, 'sub-agents', 'nested'), {
      claude: [
        '---',
        'id: deals.nested',
        'label: Nested',
        'description: Nested sub-agent.',
        'subAgents: [deals.deeper]',
        '---',
        'body',
      ].join('\n'),
      outcome: SUB_OUTCOME,
    })

    const extension = createAgentFilesExtension()
    expect(() => extension.scanModule(makeCtx(repo, 'agent_examples'))).toThrow(/depth cap/i)
  })
})
