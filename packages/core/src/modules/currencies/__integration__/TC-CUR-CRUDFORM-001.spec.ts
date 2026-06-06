import { test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures';
import { generateUniqueCurrencyCode } from '@open-mercato/core/helpers/integration/currenciesFixtures';
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-CUR-CRUDFORM-001: Reference spec for the CrudForm field-persistence sweep (#2466).
 *
 * Proves the shared `runCrudFormRoundTrip` harness against a pure-scalar makeCrud route:
 * create → read-back → assert every field → update → read-back → assert → delete.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
test.describe('TC-CUR-CRUDFORM-001: Currency CrudForm persists every field on create + update', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips all scalar fields through the currencies CRUD route', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const { organizationId, tenantId } = getTokenContext(token);
    const code = generateUniqueCurrencyCode();

    await runCrudFormRoundTrip({
      request,
      token,
      collectionPath: '/api/currencies/currencies',
      create: {
        payload: {
          organizationId,
          tenantId,
          code,
          name: 'QA CrudForm Currency',
          symbol: 'Ƀ',
          decimalPlaces: 3,
          isActive: true,
        },
      },
      expectAfterCreate: {
        scalars: {
          code,
          name: 'QA CrudForm Currency',
          symbol: 'Ƀ',
          decimalPlaces: 3,
          isActive: true,
        },
      },
      update: {
        payload: (id) => ({
          id,
          name: 'QA CrudForm Currency (edited)',
          symbol: '₿',
          decimalPlaces: 0,
          isActive: false,
        }),
      },
      expectAfterUpdate: {
        scalars: {
          code,
          name: 'QA CrudForm Currency (edited)',
          symbol: '₿',
          decimalPlaces: 0,
          isActive: false,
        },
      },
    });
  });
});
