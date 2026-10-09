import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; anyOf?: Schema[]; $defs?: Record<string, Schema>; items?: Schema; additionalProperties?: boolean; uniqueItems?: boolean }
const evaluator = await import(new URL('../../agentic/shared/scripts/evaluate-agent-harness.mjs', import.meta.url).href) as {
  codexOutputSchema?: (schema: Schema) => Schema
  codexOutputPrompt?: (prompt: string, schema: Schema) => string
  normalizeCodexOutput?: (value: unknown, schema: Schema) => unknown
}
const wireSchema = evaluator.codexOutputSchema ?? ((schema: Schema): Schema => schema)
const normalize = evaluator.normalizeCodexOutput ?? ((value: unknown): unknown => value)
const read = (name: string): Schema => JSON.parse(fs.readFileSync(new URL(`../../agentic/shared/ai/harness/${name}.schema.json`, import.meta.url), 'utf8')) as Schema

function assertStrictObjects(schema: Schema): void {
  assert.equal(schema.uniqueItems, undefined)
  if (schema.properties) {
    assert.deepEqual(new Set(schema.required), new Set(Object.keys(schema.properties)))
    assert.equal(schema.additionalProperties, false)
    Object.values(schema.properties).forEach(assertStrictObjects)
  }
  Object.values(schema.$defs ?? {}).forEach(assertStrictObjects)
  schema.anyOf?.forEach(assertStrictObjects)
  if (schema.items) assertStrictObjects(schema.items)
}

test('Codex receives required nullable optional fields recursively without changing canonical schemas', () => {
  for (const name of ['routing-response', 'generated-code-review-response']) {
    const canonical = read(name)
    const original = JSON.stringify(canonical)
    const strict = wireSchema(canonical)
    assertStrictObjects(strict)
    assert.equal(JSON.stringify(canonical), original)
  }
  const strict = wireSchema(read('routing-response'))
  assert.deepEqual(strict.properties?.specRouting.anyOf?.at(-1), { type: 'null' })
  assert.deepEqual(strict.properties?.specRouting.anyOf?.[0].properties?.coveringSpecPath.anyOf?.at(-1), { type: 'null' })
})

test('Codex absent optional routing fields normalize to the existing no-spec contract', () => {
  const response = { selectedRouter: ['architecture'], selectedSkills: [], selectedContext: [], decisions: [], violations: [], specRouting: null }
  const original = structuredClone(response)
  const normalized = normalize(response, read('routing-response'))
  assert.deepEqual(normalized, { selectedRouter: ['architecture'], selectedSkills: [], selectedContext: [], decisions: [], violations: [] })
  assert.deepEqual(response, original)
})

test('Codex keeps spec decisions, required nulls and unknown fields for canonical validation', () => {
  const response = { selectedRouter: null, selectedSkills: [], selectedContext: [], decisions: [], violations: [], unexpected: true, specRouting: { decision: 'direct', reasonCodes: ['MINOR_FIX', 'MINOR_FIX'], coveringSpecPath: null } }
  assert.deepEqual(normalize(response, read('routing-response')), { ...response, specRouting: { decision: 'direct', reasonCodes: ['MINOR_FIX', 'MINOR_FIX'] } })
  const review = { schemaVersion: 1, verdict: 'approve', report: 'report', findings: [{ severity: 'nit', path: 'file', line: null, rationale: 'reason', fix: 'fix' }], validationEvidence: [], judgeVerdict: null, designSystemReview: null }
  const { judgeVerdict: omittedVerdict, designSystemReview: omittedReview, ...expected } = review
  assert.equal(omittedVerdict, null)
  assert.equal(omittedReview, null)
  assert.deepEqual(normalize(review, read('generated-code-review-response')), expected)
})

test('Codex preserves canonical nullable references and unions while omitting transport-only nulls', () => {
  const schema = {
    type: 'object', additionalProperties: false, required: [],
    properties: {
      reference: { $ref: '#/$defs/nullable' },
      union: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      nonNullUnion: { anyOf: [{ type: 'string' }, { type: 'number' }] },
    },
    $defs: { nullable: { type: ['string', 'null'] } },
  }
  assert.deepEqual(normalize({ reference: null, union: null, nonNullUnion: null }, schema), { reference: null, union: null })
})

test('Codex transport instructions encode unrequested optional values as null without changing required outputs', () => {
  const prompt = evaluator.codexOutputPrompt ?? ((value: string): string => value)
  assert.match(prompt('Route this module publication.', read('routing-response')), /Use null for fields that the instructions omit or do not request/)
  assert.doesNotMatch(prompt('Route this module publication.', read('routing-response')), /specRouting|coveringSpecPath/)
  assert.equal(prompt('Required only.', { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] }), 'Required only.')
})
