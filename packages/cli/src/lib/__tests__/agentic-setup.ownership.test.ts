import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { applyHarnessUpdate, runAgenticSetup } from '../agentic-setup'

type ManifestEntry = {
  path: string
  sha256: string
  source: string
  userEditable: boolean
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function entry(path: string, content: string): ManifestEntry {
  return {
    path,
    sha256: hash(content),
    source: 'generated',
    userEditable: false,
  }
}

function writeManifest(root: string, files: ManifestEntry[]): string {
  const path = join(root, '.ai', 'harness', 'manifest.json')
  write(
    path,
    `${JSON.stringify({ version: 1, generator: 'open-mercato-agentic', files }, null, 2)}\n`,
  )
  return path
}

describe('applyHarnessUpdate', () => {
  let tempRoot: string
  let targetDir: string
  let stagingDir: string

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'agentic-ownership-'))
    targetDir = join(tempRoot, 'app')
    stagingDir = join(tempRoot, 'candidate')
    mkdirSync(targetDir, { recursive: true })
    mkdirSync(stagingDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('updates unchanged owned files while preserving modified and unknown files', () => {
    const oldUnchanged = 'old generated content\n'
    const oldExpectedModified = 'old generated editable content\n'
    const userModified = 'user customization\n'
    const unknownUserContent = 'private local skill\n'
    const oldMissing = 'previously generated then deleted\n'

    write(join(targetDir, '.ai', 'owned-unchanged.md'), oldUnchanged)
    write(join(targetDir, '.ai', 'owned-modified.md'), userModified)
    write(join(targetDir, '.ai', 'unknown-collision.md'), unknownUserContent)
    write(join(targetDir, '.ai', 'skills', 'custom-local', 'SKILL.md'), 'keep me\n')
    writeManifest(targetDir, [
      entry('.ai/owned-unchanged.md', oldUnchanged),
      entry('.ai/owned-modified.md', oldExpectedModified),
      entry('.ai/missing-owned.md', oldMissing),
    ])

    const nextFiles = new Map<string, string>([
      ['.ai/owned-unchanged.md', 'new generated content\n'],
      ['.ai/owned-modified.md', 'new generated editable content\n'],
      ['.ai/unknown-collision.md', 'new generated collision\n'],
      ['.ai/missing-owned.md', 'recreated generated content\n'],
    ])
    for (const [relativePath, content] of nextFiles) {
      write(join(stagingDir, relativePath), content)
    }
    writeManifest(
      stagingDir,
      [...nextFiles].map(([relativePath, content]) => entry(relativePath, content)),
    )

    const conflicts = applyHarnessUpdate(targetDir, stagingDir)

    expect(conflicts).toEqual([
      { path: '.ai/owned-modified.md', candidate: '.ai/owned-modified.md.incoming' },
      { path: '.ai/unknown-collision.md', candidate: '.ai/unknown-collision.md.incoming' },
    ])
    expect(readFileSync(join(targetDir, '.ai', 'owned-unchanged.md'), 'utf8')).toBe(
      nextFiles.get('.ai/owned-unchanged.md'),
    )
    expect(readFileSync(join(targetDir, '.ai', 'owned-modified.md'), 'utf8')).toBe(userModified)
    expect(readFileSync(join(targetDir, '.ai', 'owned-modified.md.incoming'), 'utf8')).toBe(
      nextFiles.get('.ai/owned-modified.md'),
    )
    expect(readFileSync(join(targetDir, '.ai', 'unknown-collision.md'), 'utf8')).toBe(
      unknownUserContent,
    )
    expect(readFileSync(join(targetDir, '.ai', 'unknown-collision.md.incoming'), 'utf8')).toBe(
      nextFiles.get('.ai/unknown-collision.md'),
    )
    expect(readFileSync(join(targetDir, '.ai', 'missing-owned.md'), 'utf8')).toBe(
      nextFiles.get('.ai/missing-owned.md'),
    )
    expect(readFileSync(join(targetDir, '.ai', 'skills', 'custom-local', 'SKILL.md'), 'utf8')).toBe(
      'keep me\n',
    )
    expect(readFileSync(join(targetDir, '.ai', 'harness', 'manifest.json'), 'utf8')).toBe(
      readFileSync(join(stagingDir, '.ai', 'harness', 'manifest.json'), 'utf8'),
    )
  })

  it('never overwrites a user-edited incoming candidate on a later update', () => {
    const userFile = 'user-owned harness\n'
    const firstCandidate = 'first generated candidate\n'
    const secondCandidate = 'second generated candidate\n'
    write(join(targetDir, '.ai', 'owned.md'), userFile)
    writeManifest(targetDir, [entry('.ai/owned.md', 'original generated file\n')])
    write(join(stagingDir, '.ai', 'owned.md'), firstCandidate)
    writeManifest(stagingDir, [entry('.ai/owned.md', firstCandidate)])

    expect(applyHarnessUpdate(targetDir, stagingDir)).toEqual([
      { path: '.ai/owned.md', candidate: '.ai/owned.md.incoming' },
    ])
    write(join(targetDir, '.ai', 'owned.md.incoming'), 'user edited the candidate\n')
    write(join(stagingDir, '.ai', 'owned.md'), secondCandidate)
    writeManifest(stagingDir, [entry('.ai/owned.md', secondCandidate)])

    expect(applyHarnessUpdate(targetDir, stagingDir)).toEqual([
      { path: '.ai/owned.md', candidate: '.ai/owned.md.incoming.2' },
    ])
    expect(readFileSync(join(targetDir, '.ai', 'owned.md'), 'utf8')).toBe(userFile)
    expect(readFileSync(join(targetDir, '.ai', 'owned.md.incoming'), 'utf8')).toBe('user edited the candidate\n')
    expect(readFileSync(join(targetDir, '.ai', 'owned.md.incoming.2'), 'utf8')).toBe(secondCandidate)
  })

  it('removes retired owned files but preserves modified retired assets with ownership', () => {
    const unchanged = '.claude/generated.json'
    const modified = 'CLAUDE.md'
    write(join(targetDir, unchanged), 'old generated setting\n')
    write(join(targetDir, modified), 'locally edited instructions\n')
    writeManifest(targetDir, [
      entry(unchanged, 'old generated setting\n'),
      entry(modified, 'old generated instructions\n'),
    ])
    writeManifest(stagingDir, [])

    expect(applyHarnessUpdate(targetDir, stagingDir)).toEqual([
      { path: modified, candidate: null },
    ])
    expect(existsSync(join(targetDir, unchanged))).toBe(false)
    expect(readFileSync(join(targetDir, modified), 'utf8')).toBe('locally edited instructions\n')
    const manifest = JSON.parse(readFileSync(join(targetDir, '.ai', 'harness', 'manifest.json'), 'utf8')) as {
      files: ManifestEntry[]
    }
    expect(manifest.files.map((item) => item.path)).toEqual([modified])
  })

  it('leaves the prior manifest and app files untouched when candidate validation fails', () => {
    write(join(targetDir, '.ai', 'owned.md'), 'old\n')
    const oldManifestPath = writeManifest(targetDir, [entry('.ai/owned.md', 'old\n')])
    const oldManifest = readFileSync(oldManifestPath, 'utf8')
    writeManifest(stagingDir, [entry('.ai/missing-candidate.md', 'not written\n')])

    expect(() => applyHarnessUpdate(targetDir, stagingDir)).toThrow(
      'Generated harness candidate is invalid for ".ai/missing-candidate.md".',
    )
    expect(readFileSync(join(targetDir, '.ai', 'owned.md'), 'utf8')).toBe('old\n')
    expect(readFileSync(oldManifestPath, 'utf8')).toBe(oldManifest)
  })

  it('rejects manifest paths that escape the app root before publishing', () => {
    const oldManifestPath = writeManifest(targetDir, [])
    const oldManifest = readFileSync(oldManifestPath, 'utf8')
    writeManifest(stagingDir, [entry('../escape.md', 'escape\n')])

    expect(() => applyHarnessUpdate(targetDir, stagingDir)).toThrow(
      'Generated harness candidate is invalid for "../escape.md".',
    )
    expect(readFileSync(oldManifestPath, 'utf8')).toBe(oldManifest)
  })

  it('rejects a symlinked managed ancestor without writing outside the app', () => {
    if (process.platform === 'win32') return
    const outsideDir = join(tempRoot, 'outside')
    mkdirSync(join(outsideDir, 'harness'), { recursive: true })
    write(join(outsideDir, 'sentinel.txt'), 'outside sentinel\n')
    write(
      join(outsideDir, 'harness', 'manifest.json'),
      `${JSON.stringify({ version: 1, generator: 'outside', files: [] }, null, 2)}\n`,
    )
    const nextContent = 'must stay inside the app\n'
    write(join(stagingDir, '.ai', 'owned.md'), nextContent)
    writeManifest(stagingDir, [entry('.ai/owned.md', nextContent)])
    symlinkSync(outsideDir, join(targetDir, '.ai'), 'dir')

    expect(() => applyHarnessUpdate(targetDir, stagingDir)).toThrow(
      'Harness-managed path contains a symbolic-link component',
    )
    expect(readFileSync(join(outsideDir, 'sentinel.txt'), 'utf8')).toBe('outside sentinel\n')
    expect(existsSync(join(outsideDir, 'owned.md'))).toBe(false)
    expect(readdirSync(outsideDir).sort()).toEqual(['harness', 'sentinel.txt'])
  })
})

describe('runAgenticSetup ownership modes', () => {
  let appDir: string
  let previousSkipExternal: string | undefined

  beforeEach(() => {
    appDir = mkdtempSync(join(tmpdir(), 'agentic-setup-app-'))
    write(
      join(appDir, 'src', 'modules.ts'),
      "export const enabledModules: Array<{ id: string }> = []\n",
    )
    previousSkipExternal = process.env.OM_SKIP_EXTERNAL_SKILLS
    process.env.OM_SKIP_EXTERNAL_SKILLS = '1'
    jest.spyOn(console, 'log').mockImplementation()
    jest.spyOn(console, 'warn').mockImplementation()
  })

  afterEach(() => {
    if (previousSkipExternal === undefined) delete process.env.OM_SKIP_EXTERNAL_SKILLS
    else process.env.OM_SKIP_EXTERNAL_SKILLS = previousSkipExternal
    jest.restoreAllMocks()
    rmSync(appDir, { recursive: true, force: true })
  })

  it('preserves local edits, recreates missing owned files, and reports incoming candidates', async () => {
    const ask = async () => ''
    await runAgenticSetup(appDir, ask, { tool: 'codex' })
    const originalGuide = readFileSync(join(appDir, '.ai', 'guides', 'architecture.md'), 'utf8')
    write(join(appDir, 'AGENTS.md'), '# My local harness rules\n')
    write(join(appDir, '.ai', 'skills', 'my-private-skill', 'SKILL.md'), '# Private\n')
    rmSync(join(appDir, '.ai', 'guides', 'architecture.md'))

    await runAgenticSetup(appDir, ask, { tool: 'codex', updateHarness: true })

    expect(readFileSync(join(appDir, 'AGENTS.md'), 'utf8')).toBe('# My local harness rules\n')
    expect(readFileSync(join(appDir, 'AGENTS.md.incoming'), 'utf8')).toContain(
      '<!-- CODEX_ENFORCEMENT_RULES_START -->',
    )
    expect(readFileSync(join(appDir, '.ai', 'guides', 'architecture.md'), 'utf8')).toBe(originalGuide)
    expect(readFileSync(join(appDir, '.ai', 'skills', 'my-private-skill', 'SKILL.md'), 'utf8')).toBe(
      '# Private\n',
    )
    expect(existsSync(join(appDir, '.ai', 'harness', 'manifest.json'))).toBe(true)
    if (process.platform !== 'win32') {
      expect(statSync(join(appDir, 'scripts', 'install-skills.sh')).mode & 0o111).not.toBe(0)
    }
  })

  it('keeps force semantics by replacing exact generated targets', async () => {
    const ask = async () => ''
    await runAgenticSetup(appDir, ask, { tool: 'codex' })
    write(join(appDir, 'AGENTS.md'), '# My local harness rules\n')

    await runAgenticSetup(appDir, ask, { tool: 'codex', force: true })

    expect(readFileSync(join(appDir, 'AGENTS.md'), 'utf8')).toContain(
      '<!-- CODEX_ENFORCEMENT_RULES_START -->',
    )
    expect(existsSync(join(appDir, 'AGENTS.md.incoming'))).toBe(false)
  })

  it.each([
    ['top-level .ai', '.ai'],
    ['top-level scripts', 'scripts'],
    ['nested guides', join('.ai', 'guides')],
  ])('rejects a symlinked %s destination on initial setup before writing outside the app', async (_label, linkedRelative) => {
    if (process.platform === 'win32') return
    const targetDir = join(appDir, linkedRelative.replaceAll('/', '-'))
    const outsideDir = join(appDir, `outside-initial-${linkedRelative.replaceAll('/', '-')}`)
    write(
      join(targetDir, 'src', 'modules.ts'),
      "export const enabledModules: Array<{ id: string }> = []\n",
    )
    write(join(outsideDir, 'sentinel.txt'), 'outside sentinel\n')
    const linkedPath = join(targetDir, linkedRelative)
    mkdirSync(dirname(linkedPath), { recursive: true })
    symlinkSync(outsideDir, linkedPath, 'dir')

    await expect(runAgenticSetup(targetDir, async () => '', { tool: 'codex' })).rejects.toThrow(
      'Harness-managed path contains a symbolic-link component',
    )
    expect(readFileSync(join(outsideDir, 'sentinel.txt'), 'utf8')).toBe('outside sentinel\n')
    expect(readdirSync(outsideDir)).toEqual(['sentinel.txt'])
    expect(existsSync(join(targetDir, 'AGENTS.md'))).toBe(false)
  })

  it.each([
    ['top-level .ai', '.ai'],
    ['top-level scripts', 'scripts'],
    ['nested guides', join('.ai', 'guides')],
  ])('rejects a symlinked %s destination on forced setup before writing outside the app', async (_label, linkedRelative) => {
    if (process.platform === 'win32') return
    const targetDir = join(appDir, `force-${linkedRelative.replaceAll('/', '-')}`)
    const outsideDir = join(appDir, `outside-force-${linkedRelative.replaceAll('/', '-')}`)
    write(
      join(targetDir, 'src', 'modules.ts'),
      "export const enabledModules: Array<{ id: string }> = []\n",
    )
    await runAgenticSetup(targetDir, async () => '', { tool: 'codex' })
    const originalAgents = readFileSync(join(targetDir, 'AGENTS.md'), 'utf8')
    write(join(outsideDir, 'sentinel.txt'), 'outside sentinel\n')
    const linkedPath = join(targetDir, linkedRelative)
    rmSync(linkedPath, { recursive: true, force: true })
    mkdirSync(dirname(linkedPath), { recursive: true })
    symlinkSync(outsideDir, linkedPath, 'dir')

    await expect(
      runAgenticSetup(targetDir, async () => '', { tool: 'codex', force: true }),
    ).rejects.toThrow('Harness-managed path contains a symbolic-link component')
    expect(readFileSync(join(outsideDir, 'sentinel.txt'), 'utf8')).toBe('outside sentinel\n')
    expect(readdirSync(outsideDir)).toEqual(['sentinel.txt'])
    expect(readFileSync(join(targetDir, 'AGENTS.md'), 'utf8')).toBe(originalAgents)
  })

  it('updates the harness without crashing when src/modules.ts is missing', async () => {
    rmSync(join(appDir, 'src', 'modules.ts'))

    await expect(runAgenticSetup(appDir, async () => '', {
      tool: 'codex',
      updateHarness: true,
    })).resolves.toBeUndefined()

    expect(existsSync(join(appDir, 'src', 'modules.ts'))).toBe(false)
    expect(existsSync(join(appDir, '.ai', 'harness', 'manifest.json'))).toBe(true)
  })

  it('removes unmodified tool-specific assets when switching tools', async () => {
    const ask = async () => ''
    await runAgenticSetup(appDir, ask, { tool: 'claude-code' })
    expect(existsSync(join(appDir, 'CLAUDE.md'))).toBe(true)
    expect(existsSync(join(appDir, '.claude', 'settings.json'))).toBe(true)

    await runAgenticSetup(appDir, ask, { tool: 'codex', updateHarness: true })

    expect(existsSync(join(appDir, 'CLAUDE.md'))).toBe(false)
    expect(existsSync(join(appDir, '.claude', 'settings.json'))).toBe(false)
    expect(existsSync(join(appDir, '.codex', 'mcp.json.example'))).toBe(true)
  })

  it('preserves the persisted tool selection on a bare harness update without prompting', async () => {
    const initialAsk = async () => ''
    await runAgenticSetup(appDir, initialAsk, { tool: 'claude-code,codex' })
    const ask = jest.fn(async () => {
      throw new Error('bare update must not prompt for a new tool selection')
    })

    await runAgenticSetup(appDir, ask, { updateHarness: true })

    expect(ask).not.toHaveBeenCalled()
    expect(existsSync(join(appDir, 'CLAUDE.md'))).toBe(true)
    expect(existsSync(join(appDir, '.claude', 'settings.json'))).toBe(true)
    expect(existsSync(join(appDir, '.codex', 'mcp.json.example'))).toBe(true)
    expect(existsSync(join(appDir, '.cursor', 'hooks.json'))).toBe(false)
    const tiers = JSON.parse(readFileSync(join(appDir, '.ai', 'skills', 'tiers.json'), 'utf8')) as {
      agents?: { ignore?: string[] }
    }
    expect(tiers.agents?.ignore).toEqual(['cursor'])
  })
})
