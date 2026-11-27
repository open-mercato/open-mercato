import { describe, expect, test } from '@jest/globals'
import {
  resourcesResourceCommentCreateSchema,
  resourcesResourceCreateSchema,
  resourcesResourceTagCreateSchema,
  resourcesResourceTypeCreateSchema,
  resourcesResourceUpdateSchema,
} from '../validators'

const tenantId = '123e4567-e89b-12d3-a456-426614174000'
const organizationId = '123e4567-e89b-12d3-a456-426614174001'

describe('Resources validators', () => {
  test('resourcesResourceCreateSchema rejects non-positive capacity', () => {
    expect(() =>
      resourcesResourceCreateSchema.parse({
        tenantId,
        organizationId,
        name: 'Truck',
        capacity: -1,
      }),
    ).toThrow()
  })

  test('resourcesResourceCreateSchema rejects non-integer capacity', () => {
    expect(() =>
      resourcesResourceCreateSchema.parse({
        tenantId,
        organizationId,
        name: 'Truck',
        capacity: 1.5,
      }),
    ).toThrow()
  })

  test.each([
    ['fractional', 1.5],
    ['zero', 0],
    ['negative', -3],
    ['non-numeric', 'abc'],
  ])('capacity reports a translatable key for %s input', (_label, capacity) => {
    const createResult = resourcesResourceCreateSchema.safeParse({ tenantId, organizationId, name: 'Truck', capacity })
    const updateResult = resourcesResourceUpdateSchema.safeParse({ id: organizationId, capacity })
    for (const result of [createResult, updateResult]) {
      expect(result.success).toBe(false)
      expect(result.error?.issues).toEqual([
        expect.objectContaining({ path: ['capacity'], message: 'resources.resources.validation.capacityInvalid' }),
      ])
    }
  })

  test.each([[4], ['4'], [null], [undefined]])('capacity accepts %p', (capacity) => {
    expect(resourcesResourceCreateSchema.safeParse({ tenantId, organizationId, name: 'Truck', capacity }).success).toBe(true)
    expect(resourcesResourceUpdateSchema.safeParse({ id: organizationId, capacity }).success).toBe(true)
  })

  test('resourcesResourceTypeCreateSchema validates appearanceColor', () => {
    expect(() =>
      resourcesResourceTypeCreateSchema.parse({
        tenantId,
        organizationId,
        name: 'Vehicle',
        appearanceColor: '#12345',
      }),
    ).toThrow()
  })

  test('resourcesResourceTagCreateSchema requires a label', () => {
    expect(() =>
      resourcesResourceTagCreateSchema.parse({
        tenantId,
        organizationId,
      }),
    ).toThrow()
  })

  test('resourcesResourceCommentCreateSchema requires a body', () => {
    expect(() =>
      resourcesResourceCommentCreateSchema.parse({
        tenantId,
        organizationId,
        entityId: '123e4567-e89b-12d3-a456-426614174002',
        body: '',
      }),
    ).toThrow()
  })
})
