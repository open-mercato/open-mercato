import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { buildTemplateEditorLock } from '../sync-template-editor-lock.mjs'

const readRepoFile = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8')
const rootLock = readRepoFile('yarn.lock')
const dependencies = JSON.parse(readRepoFile('packages/documents/package.json')).dependencies

test('the scaffold lock preserves the reviewed editor graph and remains reproducible', () => {
  const generated = buildTemplateEditorLock(rootLock, dependencies)
  assert.equal(readRepoFile('packages/create-app/template/yarn.lock.template'), generated)
  execFileSync(process.execPath, [fileURLToPath(new URL('../sync-template-editor-lock.mjs', import.meta.url)), '--check'])

  const source = parse(rootLock)
  const template = parse(generated)
  const editorEntries = Object.entries(template).filter(([descriptor]) => descriptor.startsWith('@tiptap/'))
  assert.ok(editorEntries.length > 0)
  for (const [, entry] of editorEntries) {
    const original = Object.values(source).find((candidate) => candidate.resolution === entry.resolution)
    assert.deepEqual(entry, original)
    assert.ok(entry.checksum)
  }
  assert.deepEqual(Object.keys(template).filter((key) => !key.startsWith('@tiptap/')), [
    '__metadata', '{{APP_NAME}}@workspace:.',
  ])
})

test('direct editor ranges resolve through the seed even when monorepo resolutions replaced their descriptors', () => {
  const template = parse(buildTemplateEditorLock(rootLock, dependencies))
  for (const [name, range] of Object.entries(dependencies).filter(([name]) => name.startsWith('@tiptap/'))) {
    assert.ok(Object.keys(template).some((descriptor) => descriptor.split(', ').includes(`${name}@npm:${range}`)))
  }
})

test('the generator refuses missing, ambiguous, incompatible, and unchecked editor resolutions', () => {
  const source = parse(rootLock)
  const [coreDescriptor, coreEntry] = Object.entries(source).find(([, entry]) => entry.resolution?.startsWith('@tiptap/core@npm:'))
  const missing = structuredClone(source)
  delete missing[coreDescriptor]
  assert.throws(() => buildTemplateEditorLock(stringify(missing), dependencies), /No reviewed editor resolution satisfies @tiptap\/core/)

  const ambiguous = structuredClone(source)
  ambiguous['@tiptap/core@npm:0.0.0'] = { ...coreEntry, version: '0.0.0', resolution: '@tiptap/core@npm:0.0.0' }
  assert.throws(() => buildTemplateEditorLock(stringify(ambiguous), dependencies), /ambiguous versions/)

  assert.throws(() => buildTemplateEditorLock(rootLock, { ...dependencies, '@tiptap/core': '0.0.0' }), /No reviewed editor resolution satisfies/)

  const unchecked = structuredClone(source)
  delete unchecked[coreDescriptor].checksum
  assert.throws(() => buildTemplateEditorLock(stringify(unchecked), dependencies), /checksummed npm package/)
})
