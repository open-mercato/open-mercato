import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-DICT-015: Cross-organization dictionary isolation within a single tenant
 *
 * Verifies that a session scoped to Organization B (`om_selected_org = orgB`)
 * cannot list, read, or add entries to a dictionary created in Organization A,
 * while Organization A retains full access to its own dictionary.
 */
test.describe('TC-DICT-015: Cross-organization dictionary isolation', () => {
  test('hides Org A dictionary from Org B on list/get and blocks cross-org entry creation', async ({ request }) => {
    const stamp = randomUUID().slice(0, 8);
    let token: string | null = null;
    let orgAId: string | null = null;
    let orgBId: string | null = null;
    let dictionaryId: string | null = null;
    let entryId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      const { tenantId } = getTokenContext(token);

      orgAId = await createOrganizationFixture(request, token, {
        name: `QA Dict Isolation Org A ${stamp}`,
        tenantId,
      });
      orgBId = await createOrganizationFixture(request, token, {
        name: `QA Dict Isolation Org B ${stamp}`,
        tenantId,
      });

      const createDictResponse = await apiRequestWithSelectedOrg(request, 'POST', '/api/dictionaries', {
        token,
        selectedOrgId: orgAId,
        data: {
          key: `qa_dict_iso_${stamp}`,
          name: `QA Isolation Dictionary ${stamp}`,
        },
      });
      expect(createDictResponse.status(), 'POST /api/dictionaries in Org A should return 201').toBe(201);
      const createdDict = await readJsonSafe<{ id?: string; organizationId?: string }>(createDictResponse);
      dictionaryId = expectId(createdDict?.id, 'Created dictionary should include id');
      expect(createdDict?.organizationId).toBe(orgAId);

      // Organization B must not see Organization A's dictionary in the list.
      const listFromOrgB = await apiRequestWithSelectedOrg(request, 'GET', '/api/dictionaries', {
        token,
        selectedOrgId: orgBId,
      });
      expect(listFromOrgB.status(), 'GET /api/dictionaries in Org B should return 200').toBe(200);
      const listFromOrgBBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(listFromOrgB);
      const orgBDictionaryIds = (listFromOrgBBody?.items ?? []).map((item) => item.id);
      expect(orgBDictionaryIds, 'Org A dictionary must not appear in Org B list').not.toContain(dictionaryId);

      // Organization B must receive 404 when reading Organization A's dictionary or its entries.
      const getFromOrgB = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}`,
        { token, selectedOrgId: orgBId },
      );
      expect(getFromOrgB.status(), 'GET /api/dictionaries/<id> from Org B should return 404').toBe(404);

      const listEntriesFromOrgB = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
        { token, selectedOrgId: orgBId },
      );
      expect(listEntriesFromOrgB.status(), 'GET /api/dictionaries/<id>/entries from Org B should return 404').toBe(404);

      // Organization B must not be able to write an entry into Organization A's dictionary.
      const createEntryFromOrgB = await apiRequestWithSelectedOrg(
        request,
        'POST',
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
        {
          token,
          selectedOrgId: orgBId,
          data: { value: 'cross_org_leak', label: 'Cross Org Leak' },
        },
      );
      expect(createEntryFromOrgB.status(), 'POST /api/dictionaries/<id>/entries from Org B should return 404').toBe(404);

      // Verify Organization A's dictionary has no leaked entries and still accepts legitimate Org A writes.
      const entriesInOrgABefore = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
        { token, selectedOrgId: orgAId },
      );
      expect(entriesInOrgABefore.status(), 'GET entries in Org A should return 200').toBe(200);
      const entriesBeforeBody = await readJsonSafe<{ items?: Array<{ value?: string }> }>(entriesInOrgABefore);
      expect(entriesBeforeBody?.items ?? [], 'No entry should have been written into Org A').toHaveLength(0);

      const createEntryInOrgA = await apiRequestWithSelectedOrg(
        request,
        'POST',
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
        {
          token,
          selectedOrgId: orgAId,
          data: { value: 'own_org_entry', label: 'Own Org Entry' },
        },
      );
      expect(createEntryInOrgA.status(), 'POST /api/dictionaries/<id>/entries in Org A should return 201').toBe(201);
      const createdEntry = await readJsonSafe<{ id?: string }>(createEntryInOrgA);
      entryId = expectId(createdEntry?.id, 'Created entry should include id');
    } finally {
      if (token && orgAId && dictionaryId && entryId) {
        await apiRequestWithSelectedOrg(
          request,
          'DELETE',
          `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries/${encodeURIComponent(entryId)}`,
          { token, selectedOrgId: orgAId },
        ).catch(() => undefined);
      }
      if (token && orgAId && dictionaryId) {
        await apiRequestWithSelectedOrg(
          request,
          'DELETE',
          `/api/dictionaries/${encodeURIComponent(dictionaryId)}`,
          { token, selectedOrgId: orgAId },
        ).catch(() => undefined);
      }
      await deleteOrganizationIfExists(request, token, orgBId);
      await deleteOrganizationIfExists(request, token, orgAId);
    }
  });
});
