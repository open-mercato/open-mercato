import { test } from '@playwright/test'

test.describe('TC-ATTACH-XSS-002: Cross-tenant access to private attachment via file route', () => {
  test('should return 404 when an authenticated user from tenant T2 reads a private attachment from tenant T1', async () => {
    // Requires two isolated tenants in the integration environment.
    // The equivalent behaviour is verified at the unit level in:
    //   - packages/core/src/modules/attachments/api/__tests__/file.route.test.ts
    //     (asserts em.findOne receives tenantId filter and checkAttachmentAccess is never called)
    test.fixme(
      true,
      'Requires multi-tenant integration environment; not available in the standard integration environment',
    )
  })
})
