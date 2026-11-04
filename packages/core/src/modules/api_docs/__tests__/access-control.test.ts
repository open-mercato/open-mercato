import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { buildAdminNav } from '@open-mercato/ui/backend/utils/nav'
import { features } from '../acl'
import { metadata } from '../backend/docs/page.meta'
import { setup } from '../setup'

describe('backend API documentation access', () => {
  it('requires authentication and a declared documentation feature', () => {
    expect(metadata.requireAuth).toBe(true)
    expect(metadata.requireFeatures).toEqual(['api_docs.view'])
    expect(features).toContainEqual(expect.objectContaining({ id: 'api_docs.view', module: 'api_docs' }))
  })

  it.each([[], ['customers.*']])('denies staff without documentation access: %j', (...grantedFeatures) => {
    expect(authorizeFeatures(metadata.requireFeatures, { grantedFeatures })).toBe(false)
  })

  it.each([['api_docs.view'], ['api_docs.*'], ['*']])('accepts documentation grants: %j', (...grantedFeatures) => {
    expect(authorizeFeatures(metadata.requireFeatures, { grantedFeatures })).toBe(true)
  })

  it('grants default administrators access without granting it to employees', () => {
    expect(authorizeFeatures(metadata.requireFeatures, {
      grantedFeatures: setup.defaultRoleFeatures?.admin ?? [],
    })).toBe(true)
    expect(authorizeFeatures(metadata.requireFeatures, {
      grantedFeatures: setup.defaultRoleFeatures?.employee ?? [],
    })).toBe(false)
  })

  it('preserves superadministrator access through the shared policy', () => {
    expect(authorizeFeatures(metadata.requireFeatures, {
      grantedFeatures: [],
      unrestricted: true,
    })).toBe(true)
  })

  it.each([
    { grantedFeatures: [], visible: false },
    { grantedFeatures: ['customers.view'], visible: false },
    { grantedFeatures: ['api_docs.view'], visible: true },
  ])('filters the documentation navigation entry with $grantedFeatures', async ({ grantedFeatures, visible }) => {
    const checkFeatures = jest.fn(async () => grantedFeatures)
    const navigation = await buildAdminNav([
      {
        id: 'api_docs',
        backendRoutes: [{ path: '/backend/docs', ...metadata }],
      },
    ], { auth: { sub: 'staff-user', roles: ['employee'] } }, undefined, undefined, { checkFeatures })

    expect(checkFeatures).toHaveBeenCalledWith(['api_docs.view'])
    expect(navigation.some((entry) => entry.href === '/backend/docs')).toBe(visible)
  })
})
