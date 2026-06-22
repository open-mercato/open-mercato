import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAgentFilesExtension } from '../lib/generators/extensions/agent-files'
import type { ModuleScanContext } from '../lib/generators/extension'

/**
 * Build a throwaway repo root carrying the `docker/opencode` + `packages`
 * sentinels the extension uses to locate the repo, plus a module `agents/` tree
 * under the app base. Returns the paths the extension's fs side effect targets.
 */
function makeRepo(): {
  root: string
  appBase: string
  pkgBase: string
  dockerAgentsDir: string
  manifestPath: string
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-files-repo-'))
  fs.mkdirSync(path.join(root, 'docker', 'opencode'), { recursive: true })
  fs.mkdirSync(path.join(root, 'packages'), { recursive: true })
  const appBase = path.join(root, 'apps', 'mercato', 'src', 'modules', 'agent_examples')
  const pkgBase = path.join(root, 'packages', 'core', 'src', 'modules', '__none__')
  fs.mkdirSync(appBase, { recursive: true })
  fs.mkdirSync(pkgBase, { recursive: true })
  return {
    root,
    appBase,
    pkgBase,
    dockerAgentsDir: path.join(root, 'docker', 'opencode', 'agents'),
    manifestPath: path.join(
      root,
      'packages',
      'core',
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
  fs.writeFileSync(path.join(agentDir, 'CLAUDE.md'), files.claude, 'utf8')
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
  'kind: actionable',
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

  it('emits a subagent .md, wires the primary task permission, and nests the manifest descriptor', () => {
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

    const primaryMd = fs.readFileSync(
      path.join(repo.dockerAgentsDir, 'deals_health_check.md'),
      'utf8',
    )
    const subMd = fs.readFileSync(path.join(repo.dockerAgentsDir, 'deals_activity_scan.md'), 'utf8')

    // Sub-agent file is mode: subagent, read-only, and may NOT delegate (task deny).
    expect(subMd).toContain('mode: subagent')
    expect(subMd).toContain('write: deny')
    expect(subMd).toContain('task: deny')
    expect(subMd).not.toContain('"task": true')

    // Primary allows the task tool and whitelists ONLY its sub-agent's name.
    expect(primaryMd).toContain('mode: primary')
    expect(primaryMd).toContain('"task": true')
    expect(primaryMd).toContain('"deals_activity_scan": allow')
    expect(primaryMd).toContain('## Sub-agents')

    // Manifest carries the sub-agent as a nested descriptor.
    const manifest = fs.readFileSync(repo.manifestPath, 'utf8')
    expect(manifest).toContain('deals.health_check')
    expect(manifest).toContain('subAgentDescriptors')
    expect(manifest).toContain('deals.activity_scan')
  })

  it('fails generation when a sub-agent is actionable (only the primary proposes)', () => {
    const repo = makeRepo()
    created.push(repo.root)
    const agentDir = path.join(repo.appBase, 'agents', 'deals_health_check')
    writeAgent(agentDir, { claude: PRIMARY_CLAUDE, outcome: PRIMARY_OUTCOME })
    writeAgent(path.join(agentDir, 'sub-agents', 'bad'), {
      claude: SUB_CLAUDE,
      // actionable sub-agent — must be rejected
      outcome: PRIMARY_OUTCOME,
    })

    const extension = createAgentFilesExtension()
    expect(() => extension.scanModule(makeCtx(repo, 'agent_examples'))).toThrow(/informative/i)
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
