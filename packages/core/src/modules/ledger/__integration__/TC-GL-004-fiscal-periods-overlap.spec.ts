import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { createFiscalPeriodFixture } from '@open-mercato/core/helpers/integration/ledgerFixtures';
import { deleteGeneralEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-GL-004: `POST /api/ledger/fiscal-periods` rejects a range that overlaps
 * an existing (non-deleted) period of the same organization with 409, and
 * two concurrent overlapping creates produce exactly one period.
 *
 * Covers the `ledger.errors.fiscalPeriodOverlap` rejection, which had no
 * test at all, and the second concurrency case the spec's Testing Strategy
 * lists (two concurrent overlapping `createFiscalPeriod` calls: exactly one
 * succeeds). The race is closed by a per-(organization, tenant)
 * `pg_advisory_xact_lock` in `commands/fiscalPeriods.ts`; the Jest unit
 * suite uses a fake EntityManager and so cannot show that a lock serializes
 * anything, which is why this runs against the real app and database.
 *
 * `FiscalPeriod` has no DELETE route in Phase 1, so rows are left behind,
 * scoped to a throwaway organization and tenant that are deleted in `finally`.
 */

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201);
  const id = body?.id;
  expect(typeof id === 'string' && id.length > 0).toBeTruthy();
  return id as string;
}

function scopedHeaders(scope: { tenantId: string; organizationId: string }): Record<string, string> {
  return {
    Cookie: [
      `om_selected_tenant=${encodeURIComponent(scope.tenantId)}`,
      `om_selected_org=${encodeURIComponent(scope.organizationId)}`,
    ].join('; '),
  };
}

async function listPeriodsInRange(
  request: APIRequestContext,
  token: string,
  headers: Record<string, string>,
  from: string,
  to: string,
): Promise<Array<{ id: string; startDate: string; endDate: string }>> {
  const response = await apiRequest(request, 'GET', '/api/ledger/fiscal-periods?pageSize=100', { token, headers });
  expect(response.status(), 'GET /api/ledger/fiscal-periods should return 200').toBe(200);
  const body = (await response.json()) as { items?: Array<{ id: string; startDate: string; endDate: string }> };
  return (body.items ?? []).filter((item) => item.startDate <= to && item.endDate >= from);
}

test.describe('TC-GL-004: fiscal-period overlap rejection and concurrent creates', () => {
  test('an overlapping range is rejected with 409 and creates nothing', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-004a Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-004a Organization ${stamp}`,
        tenantId,
      });
      const headers = scopedHeaders({ tenantId, organizationId });

      await createFiscalPeriodFixture(
        request,
        superadminToken,
        { organizationId, tenantId, startDate: '2033-02-01', endDate: '2033-02-28' },
        { headers },
      );

      // Inclusive on both ends: inside, enclosing, and sharing one boundary day.
      const overlapping: Array<[string, string]> = [
        ['2033-02-10', '2033-02-12'],
        ['2033-01-01', '2033-03-31'],
        ['2033-01-15', '2033-02-01'],
        ['2033-02-28', '2033-03-31'],
      ];
      for (const [startDate, endDate] of overlapping) {
        const response = await apiRequest(request, 'POST', '/api/ledger/fiscal-periods', {
          token: superadminToken,
          data: { organizationId, tenantId, startDate, endDate },
          headers,
        });
        expect(response.status(), `${startDate}..${endDate} overlaps 2033-02-01..2033-02-28 and should return 409`).toBe(409);
      }

      const inRange = await listPeriodsInRange(request, superadminToken, headers, '2033-01-01', '2033-03-31');
      expect(inRange, 'rejected creates must not leave a row behind').toHaveLength(1);

      // An adjacent, non-overlapping range is fine.
      await createFiscalPeriodFixture(
        request,
        superadminToken,
        { organizationId, tenantId, startDate: '2033-03-01', endDate: '2033-03-31' },
        { headers },
      );
    } finally {
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId);
    }
  });

  test('two concurrent overlapping creates: exactly one succeeds (201), the other gets 409', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-004b Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-004b Organization ${stamp}`,
        tenantId,
      });
      const headers = scopedHeaders({ tenantId, organizationId });

      // Repeat a few times with fresh, disjoint year ranges: a single attempt
      // could pass by luck of scheduling even without the lock.
      for (const year of [2034, 2035, 2036]) {
        const first = { organizationId, tenantId, startDate: `${year}-01-01`, endDate: `${year}-01-31` };
        const second = { organizationId, tenantId, startDate: `${year}-01-15`, endDate: `${year}-02-15` };
        const responses = await Promise.all([first, second].map((data) =>
          apiRequest(request, 'POST', '/api/ledger/fiscal-periods', { token: superadminToken, data, headers }),
        ));
        const statuses = responses.map((response) => response.status()).sort();
        expect(statuses, `year ${year}: one create must win and the other must conflict`).toEqual([201, 409]);

        const inRange = await listPeriodsInRange(request, superadminToken, headers, `${year}-01-01`, `${year}-02-15`);
        expect(inRange, `year ${year}: exactly one period may exist for the contested range`).toHaveLength(1);
      }
    } finally {
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId);
    }
  });

  test('generate 12 months creates twelve consecutive periods, all or nothing', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-004c Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-004c Organization ${stamp}`,
        tenantId,
      });
      const headers = scopedHeaders({ tenantId, organizationId });
      const generate = (startDate: string) =>
        apiRequest(request, 'POST', '/api/ledger/fiscal-periods/generate', {
          token: superadminToken,
          data: { startDate },
          headers,
        });

      // The start must be the first day of a month.
      const midMonth = await generate('2034-01-15');
      expect(midMonth.status(), 'a start that is not the first of a month should return 400').toBe(400);

      const created = await generate('2034-01-01');
      expect(created.status(), 'generate from 2034-01-01 should return 201').toBe(201);
      const periods = (await listPeriodsInRange(request, superadminToken, headers, '2034-01-01', '2034-12-31')).sort(
        (a, b) => a.startDate.localeCompare(b.startDate),
      );
      expect(periods, 'twelve periods should exist').toHaveLength(12);
      expect(periods[0].startDate).toBe('2034-01-01');
      expect(periods[0].endDate).toBe('2034-01-31');
      expect(periods[1].startDate, 'February follows January with no gap').toBe('2034-02-01');
      expect(periods[11].endDate).toBe('2034-12-31');

      // A second generate over the same year overlaps, answers 409 and creates nothing.
      const again = await generate('2034-01-01');
      expect(again.status(), 'generating over existing periods should return 409').toBe(409);
      const after = await listPeriodsInRange(request, superadminToken, headers, '2034-01-01', '2034-12-31');
      expect(after, 'a rejected generate must not add rows').toHaveLength(12);

      // A span that starts inside the year but runs past it overlaps too.
      const partial = await generate('2034-07-01');
      expect(partial.status(), 'a span that overlaps the existing year should return 409').toBe(409);
    } finally {
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId);
    }
  });
});
