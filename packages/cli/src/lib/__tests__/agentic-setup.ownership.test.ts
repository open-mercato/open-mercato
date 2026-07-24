import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  readFileSync,
  rmSync,
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
      '.ai/owned-modified.md',
      '.ai/unknown-collision.md',
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
  })

  it('keeps force semantics by replacing exact generated targets', async () => {
    const ask = async () => ''
    await runAgenticSetup(appDir, ask, { tool: 'codex' })
    write(join(appDir, 'AGENTS.md'), '# My local harness rules\n')

    await runAgenticSetup(appDir, ask, { tool: 'codex', force: true, updateHarness: true })

    expect(readFileSync(join(appDir, 'AGENTS.md'), 'utf8')).toContain(
      '<!-- CODEX_ENFORCEMENT_RULES_START -->',
    )
    expect(existsSync(join(appDir, 'AGENTS.md.incoming'))).toBe(false)
  })
})
