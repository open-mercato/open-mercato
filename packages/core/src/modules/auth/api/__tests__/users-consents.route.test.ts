/** @jest-environment node */

import { metadata } from '@open-mercato/core/modules/auth/api/users/consents/route'

describe('GET /api/auth/users/consents metadata', () => {
  it('requires the auth user edit feature', () => {
    expect(metadata).toMatchObject({
      path: '/auth/users/consents',
      GET: {
        requireAuth: true,
        requireFeatures: ['auth.users.edit'],
      },
    })
  })
})
