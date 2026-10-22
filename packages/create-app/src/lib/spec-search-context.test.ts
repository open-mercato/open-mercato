import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('the emitted specification index links every shipped covering specification for exact-path readers', () => {
  const directory = fileURLToPath(new URL('../../agentic/shared/ai/specs/', import.meta.url))
  const index = fs.readFileSync(path.join(directory, 'README.md'), 'utf8')
  const specifications = fs.readdirSync(directory).filter(file => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(file)).sort()
  assert.ok(specifications.length > 0)
  const links = [...index.matchAll(/\[[^\]]+\]\(\.\/([^()\s]+\.md)\)/g)].map(match => match[1])
  assert.deepEqual(links.filter(file => /^\d{4}-\d{2}-\d{2}-/.test(file)).sort(), specifications)
  for (const file of specifications) {
    assert.match(fs.readFileSync(path.join(directory, file), 'utf8'), /^# .+/m)
  }
})

test('read-only spec routing reads its index and exact covering file through bounded filename lookup', () => {
  const guide = fs.readFileSync(new URL('../../agentic/guides/spec-delivery.md', import.meta.url), 'utf8')
  assert.match(guide, /Read `\.ai\/specs\/README\.md` first, then follow its matching specification links/)
  assert.match(guide, /use bounded metadata\/filename lookup/)
  assert.match(guide, /an exact-path reader follows the index instead of guessing filenames/)
  assert.match(guide, /Never read a directory as content or report its listing in `selectedContext`/)
  assert.match(guide, /If a covering file matches, read that exact file and choose `reuse-spec` before considering a new specification/)
  assert.match(guide, /A read-only planning decision stops after classification; do not author or amend a file/)
  assert.match(guide, /plus any enterprise directory the config names/)
  assert.match(guide, /Never open a second spec for the same capability/)
  assert.match(guide, /A bug fix, minor behavioral correction, small documentation change, dependency maintenance, or an isolated refactor/)
  assert.match(guide, /the user's current request explicitly says to skip or bypass it/)
  assert.match(guide, /When the classification is genuinely ambiguous/)
})

test('spec implementation delegates exact example navigation to its scaffold owner', () => {
  const guide = fs.readFileSync(new URL('../../agentic/guides/spec-delivery.md', import.meta.url), 'utf8')
  assert.match(guide, /module work loads `om-module-scaffold`, which owns canonical-example navigation and exact capability-linked source adaptation/)
  assert.doesNotMatch(guide, /starts at `src\/modules\/example\/README\.md` and its `references\/surface-inventory\.json`/)
  assert.match(guide, /Never propose a second teaching module, copy the example tree wholesale, or treat `ratelimit_probe` as a blueprint/)
})
