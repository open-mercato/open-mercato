import { describe, expect, test } from '@jest/globals'
import { metadata } from '../index'

describe('workflows module metadata', () => {
  test('declares the business rules dependency', () => {
    expect(metadata.requires).toContain('business_rules')
  })
})
