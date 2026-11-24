import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

test('TC-DICT-014: dictionary entry creation uses the selected organization', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'admin');
  const token = await getAuthToken(request, 'superadmin');
  const { tenantId, organizationId } = getTokenScope(adminToken);
  const stamp = randomUUID();
  let otherOrganizationId: string | null = null;
  let dictionaryPath: string | null = null;

  try {
    otherOrganizationId = await createOrganizationFixture(request, token, {
      name: `QA Dictionary Scope ${stamp}`,
      tenantId,
    });
    const dictionaryResponse = await apiRequestWithSelectedOrg(request, 'POST', '/api/dictionaries', {
      token,
      selectedOrgId: organizationId,
      data: { key: `qa-dict-scope-${stamp}`, name: 'QA Dictionary Scope' },
    });
    expect(dictionaryResponse.status()).toBe(201);
    const dictionaryId = expectId((await readJsonSafe<{ id?: string }>(dictionaryResponse))?.id, 'Dictionary ID');
    dictionaryPath = `/api/dictionaries/${encodeURIComponent(dictionaryId)}`;
    const entriesPath = `${dictionaryPath}/entries`;

    const created = await apiRequestWithSelectedOrg(request, 'POST', entriesPath, {
      token,
      selectedOrgId: organizationId,
      data: { value: 'blue', label: 'Blue' },
    });
    expect(created.status()).toBe(201);

    const refused = await apiRequestWithSelectedOrg(request, 'POST', entriesPath, {
      token,
      selectedOrgId: otherOrganizationId,
      data: { value: 'orange', label: 'Orange' },
    });
    expect(refused.status()).toBe(404);

    const entries = await apiRequestWithSelectedOrg(request, 'GET', entriesPath, {
      token,
      selectedOrgId: organizationId,
    });
    expect(entries.status()).toBe(200);
    expect((await readJsonSafe<{ items: Array<{ value: string }> }>(entries))?.items.map(({ value }) => value))
      .toEqual(['blue']);
  } finally {
    if (dictionaryPath) {
      await apiRequestWithSelectedOrg(request, 'DELETE', dictionaryPath, {
        token,
        selectedOrgId: organizationId,
      }).catch(() => undefined);
    }
    await deleteOrganizationIfExists(request, token, otherOrganizationId);
  }
});
