/** @jest-environment node */

import { metadata } from '../sidebar-entities'

describe('GET /api/entities/sidebar-entities ACL', () => {
  it('requires custom-entity record view access', () => {
    expect(metadata.GET).toEqual({
      requireAuth: true,
      requireFeatures: ['entities.records.view'],
    })
  })
})
