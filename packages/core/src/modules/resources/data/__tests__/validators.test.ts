import { describe, expect, test } from '@jest/globals'
import {
  resourcesResourceCommentCreateSchema,
  resourcesResourceCreateSchema,
  resourcesResourceTagCreateSchema,
  resourcesResourceTypeCreateSchema,
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
