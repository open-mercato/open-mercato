import fs from 'node:fs'
import path from 'node:path'

function findRepoRoot(): string {
  let dir = __dirname
  for (let depth = 0; depth < 12; depth += 1) {
    if (fs.existsSync(path.join(dir, 'packages', 'core', 'src', 'modules'))) return dir
    dir = path.dirname(dir)
  }
  throw new Error('[internal] could not locate repo root from the test directory')
}

describe('RELEASE_NOTES.md retirement (issue #4024)', () => {
  const repoRoot = findRepoRoot()

  it('does not reintroduce RELEASE_NOTES.md at the repo root', () => {
    expect(fs.existsSync(path.join(repoRoot, 'RELEASE_NOTES.md'))).toBe(false)
  })

  it('keeps the migrated deprecation notes in UPGRADE_NOTES.md', () => {
    const upgradeNotes = fs.readFileSync(path.join(repoRoot, 'UPGRADE_NOTES.md'), 'utf8')
    expect(upgradeNotes).toContain('MODULE_FACTS_ALLOWLIST')
    expect(upgradeNotes).toContain('per-module standalone AI guides')
  })

  it('points the deprecation protocol at UPGRADE_NOTES.md, not the retired file', () => {
    for (const relativePath of ['AGENTS.md', 'BACKWARD_COMPATIBILITY.md']) {
      const contents = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
      expect(contents).not.toContain('RELEASE_NOTES.md')
      expect(contents).toContain('UPGRADE_NOTES.md')
    }
  })
})
