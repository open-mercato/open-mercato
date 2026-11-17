import { classifyResourceChallenge } from '../resource-challenge'

describe('classifyResourceChallenge', () => {
  it.each([
    [403, 'Bearer realm="api", error="insufficient_scope", scope="mail.read"'],
    [401, 'bearer ERROR="INSUFFICIENT_SCOPE"'],
    [403, 'Basic realm="x", Bearer error=insufficient_scope'],
    [403, 'insufficient_scope'],
    [401, 'Bearer insufficient_scope'],
    [403, 'Bearer error="insufficient_scope", error_description="needs the \\"mail.read\\" scope"'],
  ])('classifies %i with %j as scope_insufficient', (status, header) => {
    expect(classifyResourceChallenge(status, header)).toBe('scope_insufficient')
  })

  it.each([
    [400, 'Bearer error="insufficient_scope"'],
    [500, 'insufficient_scope'],
    [401, null],
    [401, ''],
    [401, 'Bearer error="invalid_token"'],
    [403, 'Bearer error="invalid_token", error_description="insufficient_scope is not the reason"'],
    [403, 'Bearer error="insufficient_scope_v2"'],
    [401, 'Bearer error="invalid_token", error_description="token has insufficient_scope here"'],
    [403, 'Bearer error_description="error=insufficient_scope", error="invalid_token"'],
    [403, 'Bearer realm="insufficient_scope", error="invalid_token"'],
  ])('returns null for %i with %j', (status, header) => {
    expect(classifyResourceChallenge(status, header)).toBeNull()
  })
})
