import { metadata as methodMetadata } from '../methods/[id]/route'
import { metadata as providerMetadata } from '../provider/[providername]/route'
import { metadata as recoveryCodeMetadata } from '../recovery-codes/regenerate/route'

const requiredFeature = ['security.mfa.manage']

describe('security MFA mutation route metadata', () => {
  test('keeps provider enrollment authenticated so the handler can apply the enforcement-aware feature guard', () => {
    expect(providerMetadata.POST).toEqual({ requireAuth: true })
    expect(providerMetadata.PUT).toEqual({ requireAuth: true })
  })

  test('requires the MFA management feature for recovery-code regeneration', () => {
    expect(recoveryCodeMetadata.POST.requireFeatures).toEqual(requiredFeature)
  })

  test('requires the MFA management feature for method removal', () => {
    expect(methodMetadata.DELETE.requireFeatures).toEqual(requiredFeature)
  })
})
