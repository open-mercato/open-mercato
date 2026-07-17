/** @jest-environment node */

import { metadata as methodMetadata } from '../methods/[id]/route'
import { metadata as providerMetadata } from '../provider/[providername]/route'
import { metadata as recoveryMetadata } from '../recovery-codes/regenerate/route'

describe('self-service MFA mutation routes are feature gated (#3855)', () => {
  it('requires security.mfa.manage on method removal', () => {
    expect(methodMetadata.DELETE).toEqual({
      requireAuth: true,
      requireFeatures: ['security.mfa.manage'],
    })
  })

  it('requires security.mfa.manage on provider setup and confirmation', () => {
    expect(providerMetadata.POST).toEqual({
      requireAuth: true,
      requireFeatures: ['security.mfa.manage'],
    })
    expect(providerMetadata.PUT).toEqual({
      requireAuth: true,
      requireFeatures: ['security.mfa.manage'],
    })
  })

  it('requires security.mfa.manage on recovery-code regeneration', () => {
    expect(recoveryMetadata.POST).toEqual({
      requireAuth: true,
      requireFeatures: ['security.mfa.manage'],
    })
  })
})
