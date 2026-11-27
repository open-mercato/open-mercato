import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const ALL_TOOLS = 'claude-code,codex,cursor,github-copilot'

const SEEDED_WORKFLOWS: Record<string, string> = {
  'ci.yml': '# user-owned CI workflow\nname: My CI\non: [push]\njobs:\n  custom:\n    runs-on: self-hosted\n    steps:\n      - run: echo "keep me"\n',
  'integration.yml': '# user-owned integration workflow\nname: My Integration\non: workflow_dispatch\njobs:\n  e2e:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "custom e2e"\n',
}

type ManifestEntry = { path: string }

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function workflowsDir(appDir: string): string {
  return join(appDir, '.github', 'workflows')
}

function assertWorkflowsUntouched(appDir: string): void {
  expect(readdirSync(workflowsDir(appDir)).sort()).toEqual(Object.keys(SEEDED_WORKFLOWS).sort())
  for (const [fileName, content] of Object.entries(SEEDED_WORKFLOWS)) {
    expect(readFileSync(join(workflowsDir(appDir), fileName), 'utf8')).toBe(content)
  }
  const manifest = JSON.parse(
    readFileSync(join(appDir, '.ai', 'harness', 'manifest.json'), 'utf8'),
  ) as { files: ManifestEntry[] }
  expect(manifest.files.length).toBeGreaterThan(0)
  expect(manifest.files.filter((item) => item.path.startsWith('.github/workflows'))).toEqual([])
}

describe('agentic generators leave user-owned CI workflows alone', () => {
  let appDir: string
  let previousCwd: string
  let previousSkipExternal: string | undefined

  beforeEach(() => {
    appDir = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-workflows-app-')))
    write(join(appDir, 'src', 'modules.ts'), "export const enabledModules: Array<{ id: string }> = []\n")
    for (const [fileName, content] of Object.entries(SEEDED_WORKFLOWS)) {
      write(join(workflowsDir(appDir), fileName), content)
    }
    previousCwd = process.cwd()
    previousSkipExternal = process.env.OM_SKIP_EXTERNAL_SKILLS
    process.env.OM_SKIP_EXTERNAL_SKILLS = '1'
    jest.spyOn(console, 'log').mockImplementation()
    jest.spyOn(console, 'warn').mockImplementation()
  })

  afterEach(() => {
    process.chdir(previousCwd)
    if (previousSkipExternal === undefined) delete process.env.OM_SKIP_EXTERNAL_SKILLS
    else process.env.OM_SKIP_EXTERNAL_SKILLS = previousSkipExternal
    jest.restoreAllMocks()
    jest.resetModules()
    jest.dontMock('../agentic-setup.js')
    rmSync(appDir, { recursive: true, force: true })
  })

  it('keeps .github/workflows byte-identical through setup, --force, and --update-harness', async () => {
    jest.resetModules()
    jest.doMock('../agentic-setup.js', () => jest.requireActual('../agentic-setup'), { virtual: true })
    const { runAgenticSetup } = await import('../agentic-setup')
    const { runAgenticInit } = await import('../agentic-init')

    await runAgenticSetup(appDir, async () => '', { tool: ALL_TOOLS })
    assertWorkflowsUntouched(appDir)

    process.chdir(appDir)
    await expect(runAgenticInit([`--tool=${ALL_TOOLS}`, '--force'])).resolves.toBe(0)
    assertWorkflowsUntouched(appDir)

    await expect(runAgenticInit(['--update-harness'])).resolves.toBe(0)
    assertWorkflowsUntouched(appDir)
  })
})
