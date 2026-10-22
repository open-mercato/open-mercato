import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('planning-gate classification does not select an authoring workflow by itself', () => {
  for (const source of ['agentic/shared/AGENTS.md.template', 'template/AGENTS.md']) {
    const root = fs.readFileSync(new URL(`../../${source}`, import.meta.url), 'utf8')
    assert.match(root, /\| `spec-pr` \| Author\/reuse spec\/plan \| Axis 3/)
    assert.doesNotMatch(root, /\| `spec-pr` \| Spec\/plan \|/)
    assert.match(root, /Spec before code: new capability\/architecture\/schema\/API contract\/cross-module\/multi-phase -> spec \(`spec-first`\)/)
    assert.match(root, /covering `\.ai\/specs` -> reuse\/update \(`reuse-spec`\)/)
    assert.match(root, /bug fix\/minor fix\/docs\/dependency\/isolated refactor -> proceed \(`direct`\)/)
    assert.match(root, /workflow-changing ambiguity -> ask once \(`ask`\)/)
    assert.match(root, /Commit\+ready PR MUST add `spec-pr`/)
    assert.match(root, /\| — \| No PR\/spec workflow \| Do not load delivery skills \|/)
  }
  const records = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url), 'utf8')) as Array<{
    id: string
    expectedRouter: { required: string[]; allowedExtra?: string[] }
    expectedSpecRouting?: { decision: string }
  }>
  for (const [id, decision, delivery] of [
    ['OMH-214', 'spec-first', true],
    ['OMH-216', 'direct', false],
    ['OMH-218', 'ask', false],
    ['OMH-227', 'reuse-spec', true],
  ] as const) {
    const record = records.find(record => record.id === id)
    assert.ok(record)
    assert.equal(record.expectedSpecRouting?.decision, decision)
    assert.equal(record.expectedRouter.required.includes('spec-pr'), delivery)
    if (!delivery) assert.ok(!record.expectedRouter.allowedExtra?.includes('spec-pr'))
  }
})
