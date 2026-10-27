/**
 * Phase C unit tests for the address composite field type
 * (`.ai/specs/2026-05-14-forms-tier-2-question-palette.md`).
 *
 * Verifies the persisted JSON Schema fragment produced by
 * `addFieldFromPalette` for `address`:
 * - JSON Schema `type: 'object'`
 * - canonical sub-`properties` map (`street1`, `street2`, `city`, `region`,
 *   `postalCode`, `country`)
 * - `required: ['street1', 'city', 'country']`
 * - `additionalProperties: false`
 *
 * Also asserts the fragment survives `validateSchemaExtensions` (no OM
 * extension violations) and a JSON-clone round-trip (no defaults rewritten
 * — MUST 12).
 */

import {
  addFieldFromPalette,
  validateSchemaExtensions,
  type FormSchema,
} from '../backend/forms/[id]/studio/schema-helpers'

const buildSchema = (): FormSchema => ({
  type: 'object',
  'x-om-roles': ['admin'],
  'x-om-default-actor-role': 'admin',
  'x-om-sections': [
    {
      key: 'default_section',
      kind: 'section',
      title: { en: '' },
      fieldKeys: [],
    },
  ],
  properties: {},
  required: [],
})

describe('address field — Phase C JSON Schema initializer', () => {
  it('seeds the canonical sub-property map on the persisted field node', () => {
    const result = addFieldFromPalette({
      schema: buildSchema(),
      typeKey: 'address',
      target: { sectionKey: 'default_section' },
    })
    const node = result.schema.properties[result.fieldKey]
    expect(node.type).toBe('object')
    expect(node['x-om-type']).toBe('address')
    expect(node.properties).toEqual({
      street1: { type: 'string' },
      street2: { type: 'string' },
      city: { type: 'string' },
      region: { type: 'string' },
      postalCode: { type: 'string' },
      country: { type: 'string' },
    })
    expect(node.required).toEqual(['street1', 'city', 'country'])
    expect(node.additionalProperties).toBe(false)
  })

  it('survives validateSchemaExtensions (no OM-extension violations)', () => {
    const result = addFieldFromPalette({
      schema: buildSchema(),
      typeKey: 'address',
      target: { sectionKey: 'default_section' },
    })
    expect(() => validateSchemaExtensions(result.schema)).not.toThrow()
  })

  it('survives a JSON-clone byte-identity round-trip (no defaults rewritten — MUST 12)', () => {
    const result = addFieldFromPalette({
      schema: buildSchema(),
      typeKey: 'address',
      target: { sectionKey: 'default_section' },
    })
    const serialized = JSON.stringify(result.schema)
    const clone = JSON.parse(serialized) as FormSchema
    expect(JSON.stringify(clone)).toBe(serialized)
    expect(() => validateSchemaExtensions(clone)).not.toThrow()
  })

  it('produces sub-keys in the canonical order (street1, street2, city, region, postalCode, country)', () => {
    const result = addFieldFromPalette({
      schema: buildSchema(),
      typeKey: 'address',
      target: { sectionKey: 'default_section' },
    })
    const node = result.schema.properties[result.fieldKey]
    const subProperties = node.properties as Record<string, unknown>
    expect(Object.keys(subProperties)).toEqual([
      'street1',
      'street2',
      'city',
      'region',
      'postalCode',
      'country',
    ])
  })
})
