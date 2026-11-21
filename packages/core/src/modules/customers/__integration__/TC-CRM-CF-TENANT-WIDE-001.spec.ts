import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  deleteCustomFieldRowsInDb,
  insertCustomFieldDefInDb,
  insertCustomFieldValueInDb,
  readCustomFieldValuesInDb,
} from '@open-mercato/core/helpers/integration/customFieldFixtures';
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';

const COMPANY_PROFILE_ENTITY_ID = 'customers:customer_company_profile';

/**
 * TC-CRM-CF-TENANT-WIDE-001
 *
 * Regression for #6029 through a real scoped read consumer (company detail GET).
 *
 * `loadCustomFieldValues` scoped definitions and values with `tenant_id IN (<tenant>, NULL)`,
 * and SQL `IN (NULL)` never matches a NULL row, so tenant-wide rows (`tenant_id IS NULL`, the
 * shape `ce.ts` installs with `global: true`) were never loaded on read. A single-value multi
 * field came back as a scalar, an encrypted field came back as ciphertext, and a value stored
 * with `tenant_id IS NULL` was missing.
 *
 * Tenant-wide definitions and the tenant-wide value are inserted directly in the database,
 * because the definitions API always pins the caller's tenant and organization. Values for the
 * multi and encrypted fields are written through the company update API, so the real write
 * path encrypts them. Rows of a second tenant are inserted next to them to prove the new
 * filter does not widen the scope beyond the caller's tenant and the tenant-wide rows, and a
 * definition of another organization in the caller's tenant proves the organization half of the
 * definitions filter still applies. The tenant-wide definitions are visible to every tenant
 * while the test runs; their keys are unique per run and teardown removes them.
 */

type CompanyDetail = { customFields?: Record<string, unknown> };

async function fetchCompanyCustomFields(
  request: APIRequestContext,
  token: string,
  companyId: string,
): Promise<Record<string, unknown>> {
  const response = await apiRequest(request, 'GET', `/api/customers/companies/${encodeURIComponent(companyId)}`, {
    token,
  });
  expect(response.status(), `GET /api/customers/companies/${companyId} should succeed`).toBe(200);
  const body = await readJsonSafe<CompanyDetail>(response);
  return body?.customFields ?? {};
}

test.describe('TC-CRM-CF-TENANT-WIDE-001: tenant-wide custom field rows on the company detail read', () => {
  test('applies tenant-wide definitions, loads tenant-wide values, and ignores rows of another tenant', async ({
    request,
  }) => {
    const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const multiKey = `qa_tenant_wide_multi_${stamp}`;
    const encryptedKey = `qa_tenant_wide_secret_${stamp}`;
    const tenantWideValueKey = `qa_tenant_wide_value_${stamp}`;
    const foreignDefinitionKey = `qa_foreign_definition_${stamp}`;
    const foreignOrgDefinitionKey = `qa_foreign_org_definition_${stamp}`;
    const foreignValueKey = `qa_foreign_value_${stamp}`;
    const allKeys = [
      multiKey,
      encryptedKey,
      tenantWideValueKey,
      foreignDefinitionKey,
      foreignOrgDefinitionKey,
      foreignValueKey,
    ];
    const secretValue = `tenant-wide-secret-${stamp}`;
    const tenantWideValue = `tenant-wide-value-${stamp}`;
    const foreignValue = `foreign-value-${stamp}`;

    let adminToken: string | null = null;
    let superadminToken: string | null = null;
    let companyId: string | null = null;
    let foreignTenantId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      superadminToken = await getAuthToken(request, 'superadmin');
      const { tenantId, organizationId } = getTokenContext(adminToken);

      foreignTenantId = expectId(
        (
          await readJsonSafe<{ id?: string }>(
            await apiRequest(request, 'POST', '/api/directory/tenants', {
              token: superadminToken,
              data: { name: `QA CF Tenant-wide Foreign ${stamp}` },
            }),
          )
        )?.id,
        'foreign tenant should be created',
      );

      await insertCustomFieldDefInDb({
        entityId: COMPANY_PROFILE_ENTITY_ID,
        tenantId: null,
        organizationId: null,
        key: multiKey,
        kind: 'select',
        configJson: { label: `QA Tenant-wide Multi ${stamp}`, multi: true, options: ['alpha', 'beta'] },
      });
      await insertCustomFieldDefInDb({
        entityId: COMPANY_PROFILE_ENTITY_ID,
        tenantId: null,
        organizationId: null,
        key: encryptedKey,
        kind: 'text',
        configJson: { label: `QA Tenant-wide Secret ${stamp}`, encrypted: true },
      });
      await insertCustomFieldDefInDb({
        entityId: COMPANY_PROFILE_ENTITY_ID,
        tenantId: null,
        organizationId: null,
        key: tenantWideValueKey,
        kind: 'text',
        configJson: { label: `QA Tenant-wide Value ${stamp}` },
      });
      await insertCustomFieldDefInDb({
        entityId: COMPANY_PROFILE_ENTITY_ID,
        tenantId: foreignTenantId,
        organizationId: null,
        key: foreignDefinitionKey,
        kind: 'select',
        configJson: { label: `QA Foreign Definition ${stamp}`, multi: true, options: ['solo'] },
      });
      await insertCustomFieldDefInDb({
        entityId: COMPANY_PROFILE_ENTITY_ID,
        tenantId,
        organizationId: randomUUID(),
        key: foreignOrgDefinitionKey,
        kind: 'select',
        configJson: { label: `QA Foreign Organization Definition ${stamp}`, multi: true, options: ['solo'] },
      });

      companyId = await createCompanyFixture(request, adminToken, `QA CF Tenant-wide Co ${stamp}`);
      const update = await apiRequest(request, 'PUT', '/api/customers/companies', {
        token: adminToken,
        data: {
          id: companyId,
          customFields: {
            [multiKey]: ['alpha'],
            [encryptedKey]: secretValue,
          },
        },
      });
      expect(update.ok(), `company custom field update failed: ${update.status()}`).toBeTruthy();

      const storedSecret = await readCustomFieldValuesInDb(COMPANY_PROFILE_ENTITY_ID, encryptedKey);
      expect(storedSecret, 'the encrypted value should be stored once').toHaveLength(1);
      expect(storedSecret[0].valueText, 'the encrypted value should be stored as ciphertext').not.toBe(secretValue);
      const profileRecordId = storedSecret[0].recordId;

      await insertCustomFieldValueInDb({
        entityId: COMPANY_PROFILE_ENTITY_ID,
        recordId: profileRecordId,
        tenantId: null,
        organizationId: null,
        key: tenantWideValueKey,
        valueText: tenantWideValue,
      });
      await insertCustomFieldValueInDb({
        entityId: COMPANY_PROFILE_ENTITY_ID,
        recordId: profileRecordId,
        tenantId,
        organizationId,
        key: foreignDefinitionKey,
        valueText: 'solo',
      });
      await insertCustomFieldValueInDb({
        entityId: COMPANY_PROFILE_ENTITY_ID,
        recordId: profileRecordId,
        tenantId,
        organizationId,
        key: foreignOrgDefinitionKey,
        valueText: 'solo',
      });
      await insertCustomFieldValueInDb({
        entityId: COMPANY_PROFILE_ENTITY_ID,
        recordId: profileRecordId,
        tenantId: foreignTenantId,
        organizationId: null,
        key: foreignValueKey,
        valueText: foreignValue,
      });

      const customFields = await fetchCompanyCustomFields(request, adminToken, companyId);
      expect.soft(customFields[multiKey], 'a single-value tenant-wide multi field reads as an array').toEqual(['alpha']);
      expect.soft(customFields[encryptedKey], 'an encrypted tenant-wide field reads as plaintext').toBe(secretValue);
      expect.soft(customFields[tenantWideValueKey], 'a value stored with tenant_id NULL is loaded').toBe(tenantWideValue);
      expect
        .soft(customFields[foreignDefinitionKey], 'a definition of another tenant does not shape the value')
        .toBe('solo');
      expect
        .soft(customFields[foreignOrgDefinitionKey], 'a definition of another organization does not shape the value')
        .toBe('solo');
      expect.soft(customFields, 'a value stored for another tenant is not loaded').not.toHaveProperty(foreignValueKey);
      expect.soft(JSON.stringify(customFields), 'the foreign value never appears in the response').not.toContain(
        foreignValue,
      );
    } finally {
      try {
        await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId);
        await deleteCustomFieldRowsInDb(COMPANY_PROFILE_ENTITY_ID, allKeys);
      } finally {
        if (superadminToken) {
          await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId);
        }
      }
    }
  });
});
