import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('read-only spec routing reads its index and exact covering file through bounded filename lookup', () => {
  const guide = fs.readFileSync(new URL('../../agentic/guides/spec-delivery.md', import.meta.url), 'utf8')
  assert.match(guide, /Read `\.ai\/specs\/README\.md` first, then use bounded metadata\/filename lookup/)
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
