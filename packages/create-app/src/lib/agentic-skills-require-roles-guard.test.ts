import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const skillsDir = new URL('../../agentic/shared/ai/skills/', import.meta.url)

function collectMarkdownFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(full))
    } else if (entry.name.endsWith('.md')) {
      files.push(full)
    }
  }
  return files
}

const negationMarker = /\b(never|avoid|avoided|deprecated|not|don't|do not|instead of)\b/i

test('no agentic skill lists requireRoles as an allowed auth guard', () => {
  const root = fs.realpathSync(skillsDir)
  const files = collectMarkdownFiles(root)
  assert.ok(files.length > 0, 'expected to find agentic skill markdown files')

  const offenders: string[] = []
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
      if (!line.includes('requireRoles')) return
      // A mention is only allowed when it tells the reader NOT to use requireRoles.
      // Listing it as an allowed guard (e.g. alongside requireAuth/requireFeatures) is a drift.
      if (!negationMarker.test(line)) {
        offenders.push(`${path.relative(root, file)}:${index + 1}: ${line.trim()}`)
      }
    })
  }

  assert.deepEqual(
    offenders,
    [],
    `Skills must gate with requireFeatures and never present requireRoles as allowed (role names mutate). Offending lines:\n${offenders.join('\n')}`,
  )
})
