import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkLessonsCatalog } from '../../packages/create-app/agentic/shared/scripts/check-lessons.mjs'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))

function createCatalogFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-lessons-'))
  fs.mkdirSync(path.join(rootDir, '.ai', 'lessons'), { recursive: true })
  fs.writeFileSync(
    path.join(rootDir, '.ai', 'lessons', 'scope-writes.md'),
    [
      '---',
      'title: "Scope writes"',
      'modules: ["customers"]',
      'areas: ["module-data", "debugging"]',
      'topics: ["tenant-scope", "data-integrity"]',
      '---',
      '',
      '# Scope writes',
      '',
      '**Rule**: Scope every write.',
      '',
    ].join('\n'),
  )
  fs.writeFileSync(
    path.join(rootDir, '.ai', 'lessons.md'),
    [
      '# Lessons',
      '',
      'This catalog indexes 1 focused lessons without loading their full text.',
      '',
      '## Catalog',
      '',
      '### module-data',
      '',
      '- [Scope writes](lessons/scope-writes.md) — area:module-data,debugging; module:customers; topic:tenant-scope,data-integrity',
      '',
    ].join('\n'),
  )
  return rootDir
}

test('repository lesson catalog is structurally valid and context bounded', () => {
  assert.deepEqual(checkLessonsCatalog(repositoryRoot), [])
})

test('lesson catalog checker accepts a focused tagged record', () => {
  const rootDir = createCatalogFixture()
  try {
    assert.deepEqual(checkLessonsCatalog(rootDir), [])
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true })
  }
})

test('lesson catalog checker rejects invalid areas and index drift', () => {
  const rootDir = createCatalogFixture()
  try {
    const lessonPath = path.join(rootDir, '.ai', 'lessons', 'scope-writes.md')
    fs.writeFileSync(
      lessonPath,
      fs.readFileSync(lessonPath, 'utf8').replace('["module-data", "debugging"]', '["bugfix"]'),
    )
    const errors = checkLessonsCatalog(rootDir)
    assert.ok(errors.some((error) => error.includes('outside the standalone router taxonomy')))
    assert.ok(errors.some((error) => error.includes('areas drift')))
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true })
  }
})
