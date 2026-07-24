import { isCallApiIdentityResolutionError } from '../call-api-identity-error'

describe('isCallApiIdentityResolutionError', () => {
  it('detects CALL_API execution identity resolution errors', () => {
    expect(
      isCallApiIdentityResolutionError(
        'Activities failed: Activity failed after 3 attempts: [CALL_API] Refusing to execute CALL_API for workflow instance abc: no traceable user roles could be resolved from the workflow instance or definition. CALL_API activities must run under the identity of the user who triggered them.',
      ),
    ).toBe(true)
  })

  it('ignores unrelated workflow errors', () => {
    expect(isCallApiIdentityResolutionError('CALL_API request failed with status 500')).toBe(false)
    expect(isCallApiIdentityResolutionError(null)).toBe(false)
  })
})
