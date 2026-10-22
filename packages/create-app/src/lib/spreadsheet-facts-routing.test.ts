import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('spreadsheet imports establish installed ownership before parser and upload design', () => {
  const reference = fs.readFileSync(new URL('../../agentic/shared/ai/skills/om-integration-builder/references/sync-and-files.md', import.meta.url), 'utf8')
  assert.match(reference, /For spreadsheet imports, first read `\.ai\/guides\/modules\/sync_excel\/index\.md`; reuse its installed upload\/import ownership before designing a parser or endpoint/)
  assert.match(reference, /Save external ID mappings and cursor only after the durable batch commits/)
  assert.match(reference, /Neutralize spreadsheet formulas, reject archive\/path traversal/)
  assert.match(reference, /Support cancellation, retry, resume, progress, and final reconciliation/)
  assert.match(reference, /Use mocked contract endpoints unless the user explicitly supplies and approves live test credentials/)
})
