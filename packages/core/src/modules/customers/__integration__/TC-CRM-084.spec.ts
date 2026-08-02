import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCompanyFixture,
  createPersonFixture,
  createDealFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * TC-CRM-084: GET /api/customers/deals/map — deals map endpoint (API)
 * Spec: .ai/specs/2026-06-10-deals-map-view-tab.md → Integration Test Coverage (TC-CRM-084)
 *
 * Verified-against-source contract (packages/core/src/modules/customers/api/deals/map/route.ts):
 * - Metadata `{ GET: { requireAuth: true, requireFeatures: ['customers.deals.view'] } }` → 401/403.
 * - Query derives from `dealListQuerySchema` with `pageSize` capped at 100 → `?pageSize=101` is a zod 400.
 * - Response: `{ items, total, page, pageSize, totalPages }`; each item carries
 *   `location: { latitude, longitude, city, region, country, source, entityId, addressId } | null`
 *   resolved with company-primary → company-earliest → person precedence (only coordinate-bearing
 *   addresses participate).
 * - Addresses are created through `POST /api/customers/addresses` (gated by
 *   `customers.activities.manage`; admin token covers it) because no address fixture helper exists.
 * - Deterministic scoping uses `?companyId=` / `?personId=` (association filter hits the link tables
 *   directly) instead of `?search=`, which routes through the async token index.
 * - Coordinates use /16-grid values (e.g. 52.1875) that are exactly representable in float4/float8,
 *   so strict equality survives the DB round-trip.
 */

const MAP_PATH = '/api/customers/deals/map';
const ADDRESSES_PATH = '/api/customers/addresses';
const COMPANIES_PATH = '/api/customers/companies';
const PEOPLE_PATH = '/api/customers/people';
const DEALS_PATH = '/api/customers/deals';
const PASSWORD = 'Secret123!';
const BASE_URL = process.env.BASE_URL?.trim() || '';

type MapAssociation = { id: string; label: string | null };

type MapLocation = {
  latitude: number;
  longitude: number;
  city: string | null;
  region: string | null;
  country: string | null;
  source: 'company' | 'person';
  entityId: string;
  addressId: string;
};

type MapItem = {
  id: string;
  title: string | null;
  status: string | null;
  valueAmount: number | null;
  valueCurrency: string | null;
  companies: MapAssociation[];
  people: MapAssociation[];
  location: MapLocation | null;
};

type MapListResponse = {
  items?: MapItem[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
};

async function createAddressFixture(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', ADDRESSES_PATH, { token, data });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), `POST ${ADDRESSES_PATH} should return 201`).toBe(201);
  return expectId(body?.id, 'Address creation response should include id');
}

async function fetchMap(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<MapListResponse> {
  const response = await apiRequest(request, 'GET', `${MAP_PATH}?${query}`, { token });
  expect(response.status(), `GET ${MAP_PATH}?${query} should return 200`).toBe(200);
  const body = await readJsonSafe<MapListResponse>(response);
  expect(body, 'map response should be parseable JSON').not.toBeNull();
  return body as MapListResponse;
}

test.describe('TC-CRM-084: deals map endpoint (GET /api/customers/deals/map)', () => {
  test('rejects unauthenticated (401) and feature-less (403) callers', async ({ request }) => {
    const stamp = Date.now();
    const restrictedEmail = `tc-crm-084-restricted-${stamp}@example.com`;
    let adminToken: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;

    const anonymous = await request.get(`${BASE_URL}${MAP_PATH}`);
    expect(anonymous.status(), 'map endpoint without a token → 401').toBe(401);

    try {
      adminToken = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(adminToken);
      expect(organizationId.length > 0 && tenantId.length > 0, 'admin token carries org + tenant').toBe(true);

      roleId = await createRoleFixture(request, adminToken, { name: `TC-CRM-084 No Deals View ${stamp}`, tenantId });
      userId = await createUserFixture(request, adminToken, {
        email: restrictedEmail,
        password: PASSWORD,
        organizationId,
        roles: [roleId],
        name: 'TC-CRM-084 Restricted',
      });
      // Grant ONLY an unrelated view feature so the map's `customers.deals.view` gate is the
      // single reason for denial (set via the ACL API so the server RBAC cache is invalidated).
      await setUserAclVisibility(request, adminToken, {
        userId,
        organizations: [organizationId],
        features: ['customers.people.view'],
      });
      const restrictedToken = await getAuthToken(request, restrictedEmail, PASSWORD);

      const sanity = await apiRequest(request, 'GET', `${PEOPLE_PATH}?page=1&pageSize=1`, { token: restrictedToken });
      expect(sanity.status(), 'granted people.view is honored (token itself works)').toBe(200);

      const denied = await apiRequest(request, 'GET', MAP_PATH, { token: restrictedToken });
      expect(denied.status(), 'map endpoint without customers.deals.view → 403').toBe(403);

      // The map exposes linked address locations, so it also requires customers.activities.view
      // (the gate on the addresses API). customers.deals.view alone must NOT be enough.
      await setUserAclVisibility(request, adminToken, {
        userId,
        organizations: [organizationId],
        features: ['customers.deals.view'],
      });
      const dealsOnlyToken = await getAuthToken(request, restrictedEmail, PASSWORD);
      const deniedWithoutActivities = await apiRequest(request, 'GET', MAP_PATH, { token: dealsOnlyToken });
      expect(
        deniedWithoutActivities.status(),
        'map endpoint with customers.deals.view but without customers.activities.view → 403',
      ).toBe(403);
    } finally {
      await deleteUserIfExists(request, adminToken, userId);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });

  test('resolves the primary company address and excludes deals without a coordinate-bearing address', async ({ request }) => {
    const stamp = Date.now();
    const locatedCompanyName = `TC-CRM-084 Located Co ${stamp}`;
    let token: string | null = null;
    let locatedCompanyId: string | null = null;
    let coordlessCompanyId: string | null = null;
    let addressId: string | null = null;
    let locatedDealId: string | null = null;
    let coordlessDealId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      locatedCompanyId = await createCompanyFixture(request, token, locatedCompanyName);
      coordlessCompanyId = await createCompanyFixture(request, token, `TC-CRM-084 Coordless Co ${stamp}`);
      addressId = await createAddressFixture(request, token, {
        entityId: locatedCompanyId,
        addressLine1: `1 Map St ${stamp}`,
        city: 'Warszawa',
        region: 'Mazowieckie',
        country: 'PL',
        latitude: 52.1875,
        longitude: 21.0,
        isPrimary: true,
      });
      locatedDealId = await createDealFixture(request, token, {
        title: `TC-CRM-084 Located Deal ${stamp}`,
        companyIds: [locatedCompanyId],
        valueAmount: 540000,
        valueCurrency: 'PLN',
      });
      coordlessDealId = await createDealFixture(request, token, {
        title: `TC-CRM-084 Coordless Deal ${stamp}`,
        companyIds: [coordlessCompanyId],
      });

      const body = await fetchMap(
        request,
        token,
        `companyId=${locatedCompanyId}&companyId=${coordlessCompanyId}&pageSize=100`,
      );
      // The map endpoint is located-only: only the deal whose linked company owns a
      // coordinate-bearing address is counted/returned; the coordless deal is excluded server-side.
      expect(body.total, 'only the located fixture deal is counted in total').toBe(1);
      expect(body.page, 'page is echoed').toBe(1);
      expect(body.pageSize, 'pageSize is echoed').toBe(100);
      expect(body.totalPages, 'one located deal fits in one page').toBe(1);
      const items = body.items ?? [];
      expect(items, 'only the located fixture deal is returned').toHaveLength(1);

      const located = items.find((item) => item.id === locatedDealId);
      const coordless = items.find((item) => item.id === coordlessDealId);
      expect(located, 'located fixture deal is present').toBeTruthy();
      expect(coordless, 'coordless fixture deal is excluded from the map').toBeFalsy();

      expect(located?.location, 'located deal carries a resolved location').not.toBeNull();
      expect(located?.location?.source, 'location is resolved from the company').toBe('company');
      expect(located?.location?.entityId, 'location points at the linked company').toBe(locatedCompanyId);
      expect(located?.location?.addressId, 'location points at the coordinate-bearing address').toBe(addressId);
      expect(Number(located?.location?.latitude), 'latitude round-trips exactly').toBe(52.1875);
      expect(Number(located?.location?.longitude), 'longitude round-trips exactly').toBe(21.0);
      expect(located?.location?.city, 'city is returned (decrypted)').toBe('Warszawa');
      expect(located?.location?.region, 'region is returned').toBe('Mazowieckie');
      expect(located?.location?.country, 'country is returned').toBe('PL');
      expect(located?.status, 'new deals default to open').toBe('open');
      expect(located?.valueAmount, 'valueAmount is projected as a number').toBe(540000);
      expect(located?.valueCurrency, 'valueCurrency is upper-cased').toBe('PLN');
      expect(located?.companies, 'company association carries the decrypted label').toEqual([
        { id: locatedCompanyId, label: locatedCompanyName },
      ]);
    } finally {
      await deleteEntityIfExists(request, token, DEALS_PATH, locatedDealId);
      await deleteEntityIfExists(request, token, DEALS_PATH, coordlessDealId);
      await deleteEntityIfExists(request, token, ADDRESSES_PATH, addressId);
      await deleteEntityIfExists(request, token, COMPANIES_PATH, locatedCompanyId);
      await deleteEntityIfExists(request, token, COMPANIES_PATH, coordlessCompanyId);
    }
  });

  test('falls back to person addresses with location.source = person', async ({ request }) => {
    const stamp = Date.now();
    const personDisplayName = `TC-CRM-084 Person ${stamp}`;
    let token: string | null = null;
    let personId: string | null = null;
    let addressId: string | null = null;
    let dealId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      personId = await createPersonFixture(request, token, {
        firstName: 'Map',
        lastName: 'Person',
        displayName: personDisplayName,
      });
      addressId = await createAddressFixture(request, token, {
        entityId: personId,
        addressLine1: `2 Person Ln ${stamp}`,
        city: 'Kraków',
        latitude: 50.0625,
        longitude: 19.9375,
        isPrimary: true,
      });
      dealId = await createDealFixture(request, token, {
        title: `TC-CRM-084 Person Deal ${stamp}`,
        personIds: [personId],
      });

      const body = await fetchMap(request, token, `personId=${personId}&pageSize=100`);
      expect(body.total, 'exactly the person-linked fixture deal matches').toBe(1);
      const item = (body.items ?? [])[0];
      expect(item?.id, 'the fixture deal is returned').toBe(dealId);
      expect(item?.location, 'person-only deal still resolves a location').not.toBeNull();
      expect(item?.location?.source, 'location source falls back to person').toBe('person');
      expect(item?.location?.entityId, 'location points at the linked person').toBe(personId);
      expect(item?.location?.addressId, 'location points at the person address').toBe(addressId);
      expect(Number(item?.location?.latitude), 'latitude round-trips exactly').toBe(50.0625);
      expect(Number(item?.location?.longitude), 'longitude round-trips exactly').toBe(19.9375);
      expect(item?.location?.city, 'city is returned (decrypted)').toBe('Kraków');
      expect(item?.people, 'person association carries the decrypted label').toEqual([
        { id: personId, label: personDisplayName },
      ]);
    } finally {
      await deleteEntityIfExists(request, token, DEALS_PATH, dealId);
      await deleteEntityIfExists(request, token, ADDRESSES_PATH, addressId);
      await deleteEntityIfExists(request, token, PEOPLE_PATH, personId);
    }
  });

  test('prefers the primary company address over an earlier non-primary address', async ({ request }) => {
    const stamp = Date.now();
    let token: string | null = null;
    let companyId: string | null = null;
    let secondaryAddressId: string | null = null;
    let primaryAddressId: string | null = null;
    let dealId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      companyId = await createCompanyFixture(request, token, `TC-CRM-084 Two Addr Co ${stamp}`);
      // The non-primary address is created FIRST: if the resolver fell back to
      // createdAt-asc instead of honoring isPrimary, it would pick this one.
      secondaryAddressId = await createAddressFixture(request, token, {
        entityId: companyId,
        addressLine1: `3 Secondary St ${stamp}`,
        city: 'Wrocław',
        latitude: 51.125,
        longitude: 17.0625,
        isPrimary: false,
      });
      primaryAddressId = await createAddressFixture(request, token, {
        entityId: companyId,
        addressLine1: `4 Primary St ${stamp}`,
        city: 'Gdańsk',
        latitude: 54.375,
        longitude: 18.625,
        isPrimary: true,
      });
      dealId = await createDealFixture(request, token, {
        title: `TC-CRM-084 Primary Wins Deal ${stamp}`,
        companyIds: [companyId],
      });

      const body = await fetchMap(request, token, `companyId=${companyId}&pageSize=100`);
      expect(body.total, 'only the fixture deal matches').toBe(1);
      const item = (body.items ?? [])[0];
      expect(item?.id, 'the fixture deal is returned').toBe(dealId);
      expect(item?.location?.source, 'location is resolved from the company').toBe('company');
      expect(item?.location?.addressId, 'the primary address wins over the earlier non-primary one').toBe(primaryAddressId);
      expect(Number(item?.location?.latitude), 'latitude comes from the primary address').toBe(54.375);
      expect(Number(item?.location?.longitude), 'longitude comes from the primary address').toBe(18.625);
      expect(item?.location?.city, 'city comes from the primary address').toBe('Gdańsk');
    } finally {
      await deleteEntityIfExists(request, token, DEALS_PATH, dealId);
      await deleteEntityIfExists(request, token, ADDRESSES_PATH, primaryAddressId);
      await deleteEntityIfExists(request, token, ADDRESSES_PATH, secondaryAddressId);
      await deleteEntityIfExists(request, token, COMPANIES_PATH, companyId);
    }
  });

  test('applies deal list filters and rejects an invalid pageSize with 400', async ({ request }) => {
    const stamp = Date.now();
    let token: string | null = null;
    let companyId: string | null = null;
    let addressId: string | null = null;
    let dealId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      companyId = await createCompanyFixture(request, token, `TC-CRM-084 Filter Co ${stamp}`);
      addressId = await createAddressFixture(request, token, {
        entityId: companyId,
        addressLine1: `5 Filter St ${stamp}`,
        city: 'Białystok',
        latitude: 53.125,
        longitude: 23.125,
        isPrimary: true,
      });
      dealId = await createDealFixture(request, token, {
        title: `TC-CRM-084 Filter Deal ${stamp}`,
        companyIds: [companyId],
      });

      // New deals default to status 'open' — a 'won' filter must exclude the located deal.
      const excluded = await fetchMap(request, token, `companyId=${companyId}&status=won&pageSize=100`);
      expect(excluded.total, 'status filter excludes the non-matching located deal from total').toBe(0);
      expect(excluded.items ?? [], 'status filter excludes the non-matching located deal from items').toHaveLength(0);

      const included = await fetchMap(request, token, `companyId=${companyId}&status=open&pageSize=100`);
      expect(included.total, 'matching status filter keeps the deal').toBe(1);
      expect((included.items ?? [])[0]?.id, 'the fixture deal passes the matching filter').toBe(dealId);
      expect((included.items ?? [])[0]?.location, 'location is still resolved under filters').not.toBeNull();

      const invalid = await apiRequest(request, 'GET', `${MAP_PATH}?pageSize=101`, { token });
      expect(invalid.status(), 'pageSize above the 100 cap → zod 400').toBe(400);
      const invalidBody = await readJsonSafe<{ error?: string }>(invalid);
      expect(typeof invalidBody?.error, '400 body carries an error message').toBe('string');
    } finally {
      await deleteEntityIfExists(request, token, DEALS_PATH, dealId);
      await deleteEntityIfExists(request, token, ADDRESSES_PATH, addressId);
      await deleteEntityIfExists(request, token, COMPANIES_PATH, companyId);
    }
  });

  test('honors every value of a repeated multi-select status filter', async ({ request }) => {
    const stamp = Date.now();
    let token: string | null = null;
    let companyId: string | null = null;
    let addressId: string | null = null;
    let openDealId: string | null = null;
    let wonDealId: string | null = null;
    let lostDealId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      companyId = await createCompanyFixture(request, token, `TC-CRM-084 MultiStatus Co ${stamp}`);
      addressId = await createAddressFixture(request, token, {
        entityId: companyId,
        addressLine1: `7 Multi St ${stamp}`,
        city: 'Katowice',
        latitude: 50.2649,
        longitude: 19.0238,
        isPrimary: true,
      });

      // One deal per wire status the filter exposes (open / win / loose).
      openDealId = await createDealFixture(request, token, {
        title: `TC-CRM-084 Open Deal ${stamp}`,
        companyIds: [companyId],
      });
      const createDealWithStatus = async (title: string, status: string): Promise<string> => {
        const res = await apiRequest(request, 'POST', DEALS_PATH, {
          token: token as string,
          data: { title, companyIds: [companyId], status },
        });
        expect(res.ok(), `POST ${DEALS_PATH} (${status}) should succeed`).toBe(true);
        const body = await readJsonSafe<{ dealId?: string; id?: string; entityId?: string }>(res);
        const id = body?.dealId ?? body?.id ?? body?.entityId;
        expect(typeof id, `created ${status} deal returns an id`).toBe('string');
        return id as string;
      };
      wonDealId = await createDealWithStatus(`TC-CRM-084 Won Deal ${stamp}`, 'win');
      lostDealId = await createDealWithStatus(`TC-CRM-084 Lost Deal ${stamp}`, 'loose');

      // Repeated multi-select: ?status=open&status=win must match BOTH, excluding the loose deal.
      // (The bug this guards: collapsing repeated params kept only the last value, so the open
      // deal silently dropped out whenever more than one status was selected.)
      const multi = await fetchMap(
        request,
        token,
        `companyId=${companyId}&status=open&status=win&pageSize=100`,
      );
      const multiIds = new Set((multi.items ?? []).map((item) => item.id));
      expect(multi.total, 'two selected statuses match exactly the two matching deals').toBe(2);
      expect(multiIds.has(openDealId), 'open deal is included by the open+win filter').toBe(true);
      expect(multiIds.has(wonDealId), 'won deal is included by the open+win filter').toBe(true);
      expect(multiIds.has(lostDealId), 'loose deal is excluded by the open+win filter').toBe(false);

      // Single value still works (no regression of the previously-passing path).
      const single = await fetchMap(request, token, `companyId=${companyId}&status=win&pageSize=100`);
      expect(single.total, 'single status still filters to one deal').toBe(1);
      expect((single.items ?? [])[0]?.id, 'single status returns the won deal').toBe(wonDealId);
    } finally {
      await deleteEntityIfExists(request, token, DEALS_PATH, openDealId);
      await deleteEntityIfExists(request, token, DEALS_PATH, wonDealId);
      await deleteEntityIfExists(request, token, DEALS_PATH, lostDealId);
      await deleteEntityIfExists(request, token, ADDRESSES_PATH, addressId);
      await deleteEntityIfExists(request, token, COMPANIES_PATH, companyId);
    }
  });

  test('does not leak deals from another organization (second home org)', async ({ request }) => {
    test.slow();

    const stamp = Date.now();
    const org2UserEmail = `tc-crm-084-org2-${stamp}@example.com`;
    let adminToken: string | null = null;
    let superToken: string | null = null;
    let org2Id: string | null = null;
    let user2Id: string | null = null;
    let user2Token: string | null = null;
    let company1Id: string | null = null;
    let address1Id: string | null = null;
    let deal1Id: string | null = null;
    let company2Id: string | null = null;
    let address2Id: string | null = null;
    let deal2Id: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      superToken = await getAuthToken(request, 'superadmin');
      const { tenantId } = getTokenContext(adminToken);
      expect(tenantId.length > 0, 'admin token carries a tenant id').toBe(true);

      // Second home org pattern (mirrors TC-ENTITIES-007): superadmin creates a sibling
      // organization in the admin tenant plus a user homed there; with roles: [] and
      // organizations: null the user's visibility collapses to its home org only.
      org2Id = await createOrganizationFixture(request, superToken, {
        name: `TC-CRM-084 Org2 ${stamp}`,
        tenantId,
      });
      user2Id = await createUserFixture(request, superToken, {
        email: org2UserEmail,
        password: PASSWORD,
        organizationId: org2Id,
        roles: [],
      });
      await setUserAclVisibility(request, superToken, {
        userId: user2Id,
        organizations: null,
        features: ['customers.*'],
      });
      user2Token = await getAuthToken(request, org2UserEmail, PASSWORD);
      expect(getTokenContext(user2Token).organizationId, 'user2 home org is the second organization').toBe(org2Id);

      company1Id = await createCompanyFixture(request, adminToken, `TC-CRM-084 Org1 Co ${stamp}`);
      address1Id = await createAddressFixture(request, adminToken, {
        entityId: company1Id,
        addressLine1: `6 Org1 St ${stamp}`,
        latitude: 52.25,
        longitude: 21.0,
        isPrimary: true,
      });
      deal1Id = await createDealFixture(request, adminToken, {
        title: `TC-CRM-084 Org1 Deal ${stamp}`,
        companyIds: [company1Id],
      });

      company2Id = await createCompanyFixture(request, user2Token, `TC-CRM-084 Org2 Co ${stamp}`);
      address2Id = await createAddressFixture(request, user2Token, {
        entityId: company2Id,
        addressLine1: `7 Org2 St ${stamp}`,
        latitude: -33.875,
        longitude: 18.4375,
        isPrimary: true,
      });
      deal2Id = await createDealFixture(request, user2Token, {
        title: `TC-CRM-084 Org2 Deal ${stamp}`,
        companyIds: [company2Id],
      });

      // Positive control: the org2 user sees its own located deal.
      const ownView = await fetchMap(request, user2Token, `companyId=${company2Id}&pageSize=100`);
      expect(ownView.total, 'org2 user sees its own deal').toBe(1);
      expect(ownView.items?.[0]?.id, 'org2 fixture deal is returned to its owner').toBe(deal2Id);
      expect(ownView.items?.[0]?.location?.source, 'org2 deal resolves its company location').toBe('company');

      // Filtering by the org1 company yields nothing for the org2-scoped user.
      const crossFiltered = await fetchMap(request, user2Token, `companyId=${company1Id}&pageSize=100`);
      expect(crossFiltered.total, 'org1 company filter matches nothing for the org2 user').toBe(0);
      expect(crossFiltered.items ?? [], 'no cross-org items leak through the company filter').toHaveLength(0);

      // The unfiltered map page for the org2 user never contains the org1 deal.
      const unfiltered = await fetchMap(request, user2Token, 'page=1&pageSize=100');
      const unfilteredIds = new Set((unfiltered.items ?? []).map((item) => item.id));
      expect(unfilteredIds.has(deal2Id), 'org2 user sees its own deal on the unfiltered map').toBe(true);
      expect(unfilteredIds.has(deal1Id as string), 'org1 deal is absent from the org2 map').toBe(false);

      // Reverse direction: the admin home-org association filter cannot reach the org2 company.
      const reverse = await fetchMap(request, adminToken, `companyId=${company2Id}&pageSize=100`);
      expect(reverse.total, 'org2 company filter matches nothing for the org1-homed admin').toBe(0);
    } finally {
      if (user2Token) {
        await deleteEntityIfExists(request, user2Token, DEALS_PATH, deal2Id);
        await deleteEntityIfExists(request, user2Token, ADDRESSES_PATH, address2Id);
        await deleteEntityIfExists(request, user2Token, COMPANIES_PATH, company2Id);
      }
      await deleteEntityIfExists(request, adminToken, DEALS_PATH, deal1Id);
      await deleteEntityIfExists(request, adminToken, ADDRESSES_PATH, address1Id);
      await deleteEntityIfExists(request, adminToken, COMPANIES_PATH, company1Id);
      await deleteUserIfExists(request, superToken, user2Id);
      await deleteOrganizationIfExists(request, superToken, org2Id);
    }
  });

  test('rejects out-of-range coordinates when creating an address (server-side bounds)', async ({ request }) => {
    const stamp = Date.now();
    let token: string | null = null;
    let companyId: string | null = null;
    let addressId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      companyId = await createCompanyFixture(request, token, `TC-CRM-084 Bounds Co ${stamp}`);

      // Latitude beyond ±90 must be rejected server-side now (range validation no longer lives only
      // in the UI), so non-UI callers can't persist a garbage coordinate that plots at a junk position.
      const outOfRange = await apiRequest(request, 'POST', ADDRESSES_PATH, {
        token,
        data: {
          entityId: companyId,
          addressLine1: `13 Junk Coord St ${stamp}`,
          latitude: 9999,
          longitude: 21.0,
          isPrimary: true,
        },
      });
      expect(outOfRange.status(), 'out-of-range latitude is rejected with a 400').toBe(400);

      // A valid coordinate within range still persists (the bound is a floor/ceiling, not a block).
      addressId = await createAddressFixture(request, token, {
        entityId: companyId,
        addressLine1: `14 Valid Coord St ${stamp}`,
        latitude: 52.1875,
        longitude: 21.0,
        isPrimary: true,
      });
      expect(addressId.length > 0, 'an in-range coordinate is still accepted').toBe(true);
    } finally {
      await deleteEntityIfExists(request, token, ADDRESSES_PATH, addressId);
      await deleteEntityIfExists(request, token, COMPANIES_PATH, companyId);
    }
  });
});
