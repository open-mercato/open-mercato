import { GET } from '../modules/onboarding/api/get/onboarding/verify'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { setupInitialTenant } from '@open-mercato/core/modules/auth/lib/setup-app'
import { OnboardingService } from '@open-mercato/onboarding/modules/onboarding/lib/service'

jest.mock('next/server', () => ({ ...jest.requireActual<typeof import('next/server')>('next/server'), after: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/modules/registry', () => ({ getModules: jest.fn() }))
jest.mock('@open-mercato/core/modules/auth/lib/setup-app', () => ({ setupInitialTenant: jest.fn() }))
jest.mock('@open-mercato/onboarding/modules/onboarding/lib/service')
jest.mock('@open-mercato/onboarding/modules/onboarding/lib/consentClientIp', () => ({ resolveConsentClientIp: jest.fn() }))
jest.mock('@open-mercato/onboarding/modules/onboarding/lib/ready-email')
jest.mock('@open-mercato/onboarding/modules/onboarding/lib/deferred-provisioning')

test('verification uses the live onboarding container and manager for tenant setup', async () => {
  const env = jest.replaceProperty(process, 'env', {
    ...process.env,
    APP_URL: 'https://example.com',
    SELF_SERVICE_ONBOARDING_ENABLED: 'true',
  })

  try {
    const manager = {}
    const container = { resolve: () => manager }
    const modules = [{ id: 'configs' }, { id: 'record_locks' }]
    const email = 'owner@example.com'
    const updateProvisioningIds = jest.fn()
    const markCompleted = jest.fn()

    jest.mocked(createRequestContainer).mockResolvedValue(container as never)
    jest.mocked(getModules).mockReturnValue(modules)
    jest.mocked(setupInitialTenant).mockResolvedValue({
      tenantId: 'tenant-id',
      organizationId: 'organization-id',
      users: [{ user: { id: 'user-id', email }, roles: ['admin'], created: true }],
      reusedExistingUser: false,
    } as never)
    jest.mocked(OnboardingService).mockImplementation(() => ({
      findByToken: jest.fn().mockResolvedValue({
        email,
        firstName: 'Tenant',
        lastName: 'Owner',
        organizationName: 'Test Workspace',
        status: 'pending',
        passwordHash: 'test-password-hash',
        expiresAt: new Date(Date.now() + 60_000),
        marketingConsent: false,
      }),
      startProcessing: jest.fn().mockResolvedValue(true),
      updateProvisioningIds,
      markCompleted,
    } as never))

    const request = new Request(`https://example.com/api/onboarding/onboarding/verify?token=${'a'.repeat(64)}`)
    const response = await GET(request)

    expect(response.headers.get('location')).toBe('https://example.com/onboarding/preparing?tenant=tenant-id')
    expect(setupInitialTenant).toHaveBeenCalledWith(manager, expect.objectContaining({
      container,
      modules,
      orgName: 'Test Workspace',
      primaryUserRoles: ['admin'],
      includeSuperadminRole: false,
    }))
    expect(markCompleted).toHaveBeenCalledTimes(1)
  } finally {
    env.restore()
  }
})
