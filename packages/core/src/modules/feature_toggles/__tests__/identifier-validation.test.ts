/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { IDENTIFIER_PATTERN, toggleCreateSchema, featureToggleSchema } from '../data/validators'

describe('feature toggle identifier validation (#2055 QA round-6)', () => {
  test('accepts namespaced seeded identifiers with dots and dashes', () => {
    // The exact seeded identifier QA reported as failing validation.
    expect(IDENTIFIER_PATTERN.test('customers.interactions.legacy-adapters')).toBe(true)
    expect(IDENTIFIER_PATTERN.test('customers_interactions_legacy_adapters')).toBe(true)
    expect(IDENTIFIER_PATTERN.test('feature.v2-beta')).toBe(true)
  })

  test('still requires a leading lowercase letter and rejects invalid characters', () => {
    expect(IDENTIFIER_PATTERN.test('1leading-digit')).toBe(false)
    expect(IDENTIFIER_PATTERN.test('-leading-dash')).toBe(false)
    expect(IDENTIFIER_PATTERN.test('Has.Uppercase')).toBe(false)
    expect(IDENTIFIER_PATTERN.test('has space')).toBe(false)
    expect(IDENTIFIER_PATTERN.test('has/slash')).toBe(false)
  })

  test('toggleCreateSchema accepts the dotted+dashed identifier', () => {
    const parsed = toggleCreateSchema.safeParse({
      identifier: 'customers.interactions.legacy-adapters',
      name: 'Legacy adapters',
      type: 'boolean',
    })
    expect(parsed.success).toBe(true)
  })

  test('featureToggleSchema accepts the dotted+dashed identifier (edit-only description change no longer 422s)', () => {
    const parsed = featureToggleSchema.safeParse({
      identifier: 'customers.interactions.legacy-adapters',
      name: 'Legacy adapters',
      description: 'Updated description only',
      type: 'boolean',
    })
    expect(parsed.success).toBe(true)
  })
})
