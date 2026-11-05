import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import { deleteUserAclInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';

const COMPANY_PROFILE_ENTITY_ID = 'customers:customer_company_profile';

/**
 * TC-CRM-CF-ORG-WIDE-001
 *
 * Regression for #6029 through a real scoped read consumer (company detail GET).
 *
 * `loadCustomFieldValues` loaded definitions with `organization_id IN (...)`, and SQL
 * `IN (NULL)` never matches a NULL row, so organization-wide definitions (the shape
 * `ce.ts` installs: tenant set, organization NULL) were never loaded on read. A
 * single-value multi field came back as a scalar and an encrypted field came back as
 * ciphertext.
 *
 * Organization-wide definitions are inserted directly in the database, because the
 * definitions API always pins the caller's organization. Values are written through the
 * company update API, so the real write path encrypts them.
 */

type CompanyDetail = { customFields?: Record<string, unknown> };

async function insertOrganizationWideDefinition(input: {
  tenantId: string;
  key: string;
  kind: string;
  configJson: Record<string, unknown>;
}): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into custom_field_defs
         (id, entity_id, organization_id, tenant_id, key, kind, config_json, is_active, created_at, updated_at)
       values (gen_random_uuid(), $1, null, $2, $3, $4, $5::jsonb, true, now(), now())
       returning id`,
      [COMPANY_PROFILE_ENTITY_ID, input.tenantId, input.key, input.kind, JSON.stringify(input.configJson)],
    );
    return result.rows[0].id;
  });
}

async function readStoredTextValues(fieldKey: string): Promise<string[]> {
  return withClient(async (client) => {
    const result = await client.query<{ value_text: string | null }>(
      `select value_text from custom_field_values
        where entity_id = $1 and field_key = $2 and deleted_at is null`,
      [COMPANY_PROFILE_ENTITY_ID, fieldKey],
    );
    return result.rows.map((row) => String(row.value_text));
  });
}

async function deleteCustomFieldRowsInDb(keys: string[]): Promise<void> {
  await withClient(async (client) => {
    await client.query('delete from custom_field_values where entity_id = $1 and field_key = any($2)', [
      COMPANY_PROFILE_ENTITY_ID,
      keys,
    ]);
    await client.query('delete from custom_field_defs where entity_id = $1 and key = any($2)', [
      COMPANY_PROFILE_ENTITY_ID,
      keys,
    ]);
  });
}

async function fetchCompanyDetail(request: APIRequestContext, token: string, companyId: string) {
  return apiRequest(request, 'GET', `/api/customers/companies/${encodeURIComponent(companyId)}`, { token });
}

async function fetchCompanyCustomFields(
  request: APIRequestContext,
  token: string,
  companyId: string,
): Promise<Record<string, unknown>> {
  const response = await fetchCompanyDetail(request, token, companyId);
  expect(response.status(), `GET /api/customers/companies/${companyId} should succeed`).toBe(200);
  const body = await readJsonSafe<CompanyDetail>(response);
  return body?.customFields ?? {};
}

test.describe('TC-CRM-CF-ORG-WIDE-001: organization-wide custom field definitions on the company detail read', () => {
  test('applies organization-wide multi and encryption settings, keeps organization precedence, and stays tenant-bound', async ({
    request,
  }) => {
    const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const multiKey = `qa_org_wide_multi_${stamp}`;
    const encryptedKey = `qa_org_wide_secret_${stamp}`;
    const precedenceKey = `qa_org_wide_precedence_${stamp}`;
    const secretValue = `org-wide-secret-${stamp}`;
    const foreignEmail = `qa-cf-org-wide-${stamp}@test.invalid`;
    const foreignPassword = 'Valid1!Pass';

    let adminToken: string | null = null;
    let superadminToken: string | null = null;
    let companyId: string | null = null;
    let foreignTenantId: string | null = null;
    let foreignOrganizationId: string | null = null;
    let foreignUserId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      superadminToken = await getAuthToken(request, 'superadmin');
      const { tenantId } = getTokenContext(adminToken);

      await insertOrganizationWideDefinition({
        tenantId,
        key: multiKey,
        kind: 'select',
        configJson: { label: `QA Org-wide Multi ${stamp}`, multi: true, options: ['alpha', 'beta'] },
      });
      await insertOrganizationWideDefinition({
        tenantId,
        key: encryptedKey,
        kind: 'text',
        configJson: { label: `QA Org-wide Secret ${stamp}`, encrypted: true },
      });
      await insertOrganizationWideDefinition({
        tenantId,
        key: precedenceKey,
        kind: 'select',
        configJson: { label: `QA Org-wide Precedence ${stamp}`, multi: true, options: ['one', 'two'] },
      });
      const organizationDefinition = await apiRequest(request, 'POST', '/api/entities/definitions', {
        token: adminToken,
        data: {
          entityId: COMPANY_PROFILE_ENTITY_ID,
          key: precedenceKey,
          kind: 'select',
          configJson: { label: `QA Org Precedence ${stamp}`, multi: false, options: ['one', 'two'] },
        },
      });
      expect(organizationDefinition.status(), 'organization-specific definition should be created').toBe(200);

      companyId = await createCompanyFixture(request, adminToken, `QA CF Org-wide Co ${stamp}`);
      const update = await apiRequest(request, 'PUT', '/api/customers/companies', {
        token: adminToken,
        data: {
          id: companyId,
          customFields: {
            [multiKey]: ['alpha'],
            [encryptedKey]: secretValue,
            [precedenceKey]: 'one',
          },
        },
      });
      expect(update.ok(), `company custom field update failed: ${update.status()}`).toBeTruthy();

      const storedSecret = await readStoredTextValues(encryptedKey);
      expect(storedSecret, 'the encrypted value should be stored once').toHaveLength(1);
      expect(storedSecret[0], 'the encrypted value should be stored as ciphertext').not.toBe(secretValue);

      const customFields = await fetchCompanyCustomFields(request, adminToken, companyId);
      expect.soft(customFields[multiKey], 'a single-value organization-wide multi field reads as an array').toEqual([
        'alpha',
      ]);
      expect.soft(customFields[encryptedKey], 'an encrypted organization-wide field reads as plaintext').toBe(secretValue);
      expect.soft(customFields[precedenceKey], 'the organization-specific definition wins over the organization-wide one').toBe(
        'one',
      );

      foreignTenantId = expectId(
        (
          await readJsonSafe<{ id?: string }>(
            await apiRequest(request, 'POST', '/api/directory/tenants', {
              token: superadminToken,
              data: { name: `QA CF Org-wide Tenant ${stamp}` },
            }),
          )
        )?.id,
        'foreign tenant should be created',
      );
      foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA CF Org-wide Organization ${stamp}`,
        tenantId: foreignTenantId,
      });
      foreignUserId = await createUserFixture(request, superadminToken, {
        email: foreignEmail,
        password: foreignPassword,
        organizationId: foreignOrganizationId,
        roles: [],
      });
      await setUserAclInDb({
        userId: foreignUserId,
        tenantId: foreignTenantId,
        features: ['customers.companies.view'],
        organizations: null,
      });

      const foreignToken = await getAuthToken(request, foreignEmail, foreignPassword);
      const foreignRead = await fetchCompanyDetail(request, foreignToken, companyId);
      expect(foreignRead.status(), 'another tenant must not read the company').toBe(404);
      expect(await foreignRead.text(), 'another tenant must not receive the decrypted value').not.toContain(secretValue);
    } finally {
      if (foreignUserId) await deleteUserAclInDb(foreignUserId);
      await deleteUserIfExists(request, superadminToken, foreignUserId);
      await deleteOrganizationIfExists(request, superadminToken, foreignOrganizationId);
      if (superadminToken) {
        await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId);
      }
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId);
      await deleteCustomFieldRowsInDb([multiKey, encryptedKey, precedenceKey]);
    }
  });
});
