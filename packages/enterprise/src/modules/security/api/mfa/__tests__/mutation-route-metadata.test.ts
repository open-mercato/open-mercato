import { metadata as methodMetadata } from '../methods/[id]/route'
import { metadata as providerMetadata } from '../provider/[providername]/route'
import { metadata as recoveryCodeMetadata } from '../recovery-codes/regenerate/route'

const requiredFeature = ['security.mfa.manage']

describe('security MFA mutation route metadata', () => {
  test('requires the MFA management feature for provider setup and confirmation', () => {
    expect(providerMetadata.POST.requireFeatures).toEqual(requiredFeature)
    expect(providerMetadata.PUT.requireFeatures).toEqual(requiredFeature)
  })

  test('requires the MFA management feature for recovery-code regeneration', () => {
    expect(recoveryCodeMetadata.POST.requireFeatures).toEqual(requiredFeature)
  })

  test('requires the MFA management feature for method removal', () => {
    expect(methodMetadata.DELETE.requireFeatures).toEqual(requiredFeature)
  })
})
