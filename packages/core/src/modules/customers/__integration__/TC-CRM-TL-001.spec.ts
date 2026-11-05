import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  getTokenContext,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createDealFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
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
import {
  addBuckets,
  addDays,
  alignToBucketStart,
  toUtcDateKey,
} from '@open-mercato/core/modules/customers/lib/dealsTimeline';
import type {
  DealTimelineCellResponse,
  DealTimelineResponse,
} from '@open-mercato/core/modules/customers/lib/dealsTimelineTypes';

/**
 * TC-CRM-TL-001: GET /api/customers/deals/timeline (API)
 * Spec: .ai/specs/2026-10-26-deals-close-date-timeline.md → Integration Test Coverage (TC-CRM-TL-001)
 *
 * Every grid request is narrowed to a fixture pipeline so seeded/demo deals never affect counts.
 * The window starts next week (future) so only the dedicated overdue fixture is overdue.
 */

const TIMELINE_PATH = '/api/customers/deals/timeline';
const DEALS_PATH = '/api/customers/deals';
const PIPELINES_PATH = '/api/customers/pipelines';
const STAGES_PATH = '/api/customers/pipeline-stages';
const PASSWORD = 'Secret123!';
const BASE_URL = process.env.BASE_URL?.trim() || '';

async function fetchTimeline(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<DealTimelineResponse> {
  const response = await apiRequest(request, 'GET', `${TIMELINE_PATH}?${query}`, { token });
  expect(response.status(), `GET ${TIMELINE_PATH}?${query} should return 200`).toBe(200);
  const body = await readJsonSafe<DealTimelineResponse>(response);
  expect(body, 'timeline response should be JSON').not.toBeNull();
  return body as DealTimelineResponse;
}

async function fetchCell(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<DealTimelineCellResponse> {
  const response = await apiRequest(request, 'GET', `${TIMELINE_PATH}?${query}`, { token });
  expect(response.status(), `GET ${TIMELINE_PATH}?${query} (cell mode) should return 200`).toBe(200);
  const body = await readJsonSafe<DealTimelineCellResponse>(response);
  expect(body, 'cell response should be JSON').not.toBeNull();
  return body as DealTimelineCellResponse;
}

function allItemIds(response: DealTimelineResponse): string[] {
  return response.lanes.flatMap((lane) => lane.cells.flatMap((cell) => cell.items.map((item) => item.id)));
}

function closeAt(dateKey: string): string {
  return `${dateKey}T00:00:00.000Z`;
}

test.describe('TC-CRM-TL-001: deals timeline endpoint (GET /api/customers/deals/timeline)', () => {
  test('rejects unauthenticated (401) and feature-less (403) callers', async ({ request }) => {
    const stamp = Date.now();
    const restrictedEmail = `tc-crm-tl-001-restricted-${stamp}@example.com`;
    let adminToken: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;

    const anonymous = await request.get(`${BASE_URL}${TIMELINE_PATH}`);
    expect(anonymous.status(), 'timeline without a token → 401').toBe(401);

    try {
      adminToken = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(adminToken);
      roleId = await createRoleFixture(request, adminToken, { name: `TC-CRM-TL-001 No Deals ${stamp}`, tenantId });
      userId = await createUserFixture(request, adminToken, {
        email: restrictedEmail,
        password: PASSWORD,
        organizationId,
        roles: [roleId],
        name: 'TC-CRM-TL-001 Restricted',
      });
      await setUserAclVisibility(request, adminToken, {
        userId,
        organizations: [organizationId],
        features: ['customers.people.view'],
      });
      const restrictedToken = await getAuthToken(request, restrictedEmail, PASSWORD);
      const denied = await apiRequest(request, 'GET', TIMELINE_PATH, { token: restrictedToken });
      expect(denied.status(), 'timeline without customers.deals.view → 403').toBe(403);
    } finally {
      await deleteUserIfExists(request, adminToken, userId);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });

  test('buckets, counts, lanes, side data, filters and cell mode match the fixtures', async ({ request }) => {
    test.slow();
    const stamp = Date.now();
    const adminToken = await getAuthToken(request, 'admin');
    const superToken = await getAuthToken(request, 'superadmin');
    const adminUserId = getTokenScope(adminToken).userId;
    const otherOwnerId = getTokenScope(superToken).userId;
    expect(adminUserId.length > 0 && otherOwnerId.length > 0, 'token subjects resolve to user ids').toBe(true);

    const todayKey = toUtcDateKey(new Date()) as string;
    const from = addBuckets(alignToBucketStart(todayKey, 'week'), 'week', 1);
    const col1From = addBuckets(from, 'week', 1);
    const col2From = addBuckets(from, 'week', 2);
    const sameDay = addDays(from, 3);
    const overdueDate = addDays(todayKey, -20);
    const nextDate = addBuckets(from, 'week', 10);

    const createdDeals: string[] = [];
    let pipelineId: string | null = null;
    let otherPipelineId: string | null = null;
    const stageIds: string[] = [];

    try {
      pipelineId = await createPipelineFixture(request, adminToken, { name: `TC-CRM-TL-001 Pipeline ${stamp}` });
      otherPipelineId = await createPipelineFixture(request, adminToken, { name: `TC-CRM-TL-001 Other ${stamp}` });
      for (let order = 0; order < 3; order += 1) {
        stageIds.push(
          await createPipelineStageFixture(request, adminToken, {
            pipelineId,
            label: `TC-CRM-TL-001 Stage ${order} ${stamp}`,
            order,
          }),
        );
      }
      const otherStageId = await createPipelineStageFixture(request, adminToken, {
        pipelineId: otherPipelineId,
        label: `TC-CRM-TL-001 Other Stage ${stamp}`,
        order: 0,
      });

      const make = async (
        title: string,
        input: { date?: string; owner?: string; stage?: string | null; status?: string; pipeline?: string },
      ): Promise<string> => {
        const id = await createDealFixture(request, adminToken, {
          title: `TC-CRM-TL-001 ${title} ${stamp}`,
          pipelineId: input.pipeline ?? (pipelineId as string),
          pipelineStageId: input.stage === null ? undefined : input.stage ?? stageIds[0],
          status: input.status ?? 'open',
          expectedCloseAt: input.date ? closeAt(input.date) : undefined,
          ownerUserId: input.owner,
          valueAmount: 1000,
          valueCurrency: 'USD',
        });
        createdDeals.push(id);
        return id;
      };

      const earlyId = await make('Early', { date: addDays(from, 1), owner: adminUserId });
      const sameA = await make('Same A', { date: sameDay, owner: adminUserId });
      const sameB = await make('Same B', { date: sameDay, owner: adminUserId });
      const boundaryId = await make('Boundary', { date: col1From, owner: adminUserId, stage: stageIds[1] });
      const unassignedId = await make('Unassigned', { date: col2From, stage: null });
      const wonId = await make('Won', { date: addDays(col2From, 1), owner: adminUserId, status: 'win' });
      const otherPipelineDealId = await make('Other pipeline', {
        date: addDays(from, 1),
        owner: adminUserId,
        pipeline: otherPipelineId,
        stage: otherStageId,
      });
      const overdueId = await make('Overdue', { date: overdueDate, owner: adminUserId });
      const nextId = await make('Next', { date: nextDate, owner: adminUserId });
      const undatedId = await make('Undated', { owner: adminUserId });
      const undatedWonId = await make('Undated won', { owner: adminUserId, status: 'win' });

      const unassignedRead = await apiRequest(request, 'GET', `${DEALS_PATH}?ids=${unassignedId}`, { token: adminToken });
      const unassignedBody = await readJsonSafe<{ items?: Array<{ pipelineStageId?: string | null; pipeline_stage_id?: string | null }> }>(unassignedRead);
      const unassignedStage = unassignedBody?.items?.[0]?.pipelineStageId ?? unassignedBody?.items?.[0]?.pipeline_stage_id ?? null;

      const base = `bucket=week&from=${from}&columns=3&pipelineId=${pipelineId}`;

      const grid = await fetchTimeline(request, adminToken, `${base}&perCell=2&excludeClosed=true`);
      expect(grid.from, 'window starts at the aligned from').toBe(from);
      expect(grid.columns.map((column) => column.from)).toEqual([from, col1From, col2From]);
      expect(grid.columns.map((column) => column.total), 'exact column totals').toEqual([3, 1, 1]);
      const adminLane = grid.lanes.find((lane) => lane.key === adminUserId);
      expect(adminLane, 'owner lane for the admin exists').toBeTruthy();
      expect(adminLane?.total, 'owner lane total').toBe(4);
      const busy = adminLane?.cells.find((cell) => cell.column === 0);
      expect(busy?.total, 'busy cell total').toBe(3);
      const expectedTop = [earlyId, [sameA, sameB].sort()[0]];
      expect(busy?.items.map((item) => item.id), 'perCell=2 items ordered by date then id').toEqual(expectedTop);
      expect(busy?.items[0]?.title, 'decrypted title').toBe(`TC-CRM-TL-001 Early ${stamp}`);
      expect(busy?.items[0]?.expectedCloseAt).toBe(addDays(from, 1));
      expect(adminLane?.cells.find((cell) => cell.column === 1)?.items.map((item) => item.id), 'boundary deal in column 1 only').toEqual([boundaryId]);
      const unassignedLane = grid.lanes[grid.lanes.length - 1];
      expect(unassignedLane?.key, 'Unassigned lane comes last').toBe('__unassigned');
      expect(unassignedLane?.cells.find((cell) => cell.column === 2)?.items.map((item) => item.id)).toEqual([unassignedId]);
      const gridIds = allItemIds(grid);
      expect(gridIds, 'won deal excluded by default').not.toContain(wonId);
      expect(gridIds, 'other pipeline deal excluded by the pipeline filter').not.toContain(otherPipelineDealId);
      expect(gridIds.filter((id) => id === boundaryId), 'boundary deal listed once').toHaveLength(1);

      expect(grid.overdueBefore.count, 'one overdue open deal before the window').toBe(1);
      expect(grid.overdueBefore.latestExpectedCloseAt).toBe(overdueDate);
      expect(grid.undatedCount, 'undated count excludes the closed undated deal').toBe(1);
      expect(grid.adjacent.previous, 'nearest deal before the window').toBe(overdueDate);
      expect(grid.adjacent.next, 'nearest deal after the window').toBe(nextDate);
      expect(grid.scopeHasDeals).toBe(true);
      expect(grid.truncated).toBe(false);

      const withWon = await fetchTimeline(request, adminToken, `${base}&status=open&status=win`);
      expect(allItemIds(withWon), 'status=open&status=win includes the won deal').toContain(wonId);
      expect(allItemIds(withWon)).toContain(earlyId);

      const allDeals = await fetchTimeline(request, adminToken, `${base}&excludeClosed=false`);
      expect(allItemIds(allDeals), 'excludeClosed=false includes the won deal').toContain(wonId);

      const owners = await fetchTimeline(
        request,
        adminToken,
        `${base}&ownerUserId=${adminUserId}&ownerUserId=${otherOwnerId}`,
      );
      const emptyOwnerLane = owners.lanes.find((lane) => lane.key === otherOwnerId);
      expect(emptyOwnerLane, 'selected owner without deals still gets a lane').toBeTruthy();
      expect(emptyOwnerLane?.total).toBe(0);
      expect(owners.lanes.some((lane) => lane.key === '__unassigned'), 'owner filter drops unassigned deals').toBe(false);

      const stages = await fetchTimeline(request, adminToken, `${base}&groupBy=stage`);
      const stageLaneKeys = stages.lanes.map((lane) => lane.key);
      expect(stageLaneKeys.slice(0, 3), 'every stage of the pipeline in order, including empty ones').toEqual(stageIds);
      expect(stages.lanes.find((lane) => lane.key === stageIds[2])?.total, 'empty stage lane').toBe(0);
      expect(stages.lanes.find((lane) => lane.key === stageIds[0])?.stage?.pipelineName).toBe(`TC-CRM-TL-001 Pipeline ${stamp}`);

      const page1 = await fetchCell(request, adminToken, `${base}&cellLane=${adminUserId}&cellColumn=0&page=1&pageSize=2`);
      expect(page1.total, 'cell mode exact total').toBe(3);
      expect(page1.totalPages).toBe(2);
      expect(page1.items).toHaveLength(2);
      const page2 = await fetchCell(request, adminToken, `${base}&cellLane=${adminUserId}&cellColumn=0&page=2&pageSize=2`);
      expect(page2.items).toHaveLength(1);
      expect([...page1.items, ...page2.items].map((item) => item.id).sort(), 'popover lists every deal of the cell').toEqual(
        [earlyId, sameA, sameB].sort(),
      );

      const unassignedCell = await fetchCell(request, adminToken, `${base}&cellLane=__unassigned&cellColumn=2`);
      expect(unassignedCell.items.map((item) => item.id), 'unassigned cell returns only owner-less deals').toEqual([unassignedId]);

      const boundaryCell = await fetchCell(request, adminToken, `${base}&cellLane=${adminUserId}&cellColumn=1`);
      expect(boundaryCell.items.map((item) => item.id), 'boundary deal only in the next column').toEqual([boundaryId]);

      expect(unassignedStage, 'a deal created without a stage keeps a null stage').toBeNull();
      const noStageLane = stages.lanes.find((lane) => lane.key === `__nostage:${pipelineId}`);
      expect(noStageLane, 'pipeline no-stage lane exists').toBeTruthy();
      const noStageCell = await fetchCell(
        request,
        adminToken,
        `${base}&groupBy=stage&cellLane=__nostage:${pipelineId}&cellColumn=2`,
      );
      expect(noStageCell.items.map((item) => item.id), 'no-stage cell returns only stage-less deals').toEqual([unassignedId]);

      const undatedList = await apiRequest(
        request,
        'GET',
        `${DEALS_PATH}?pipelineId=${pipelineId}&hasExpectedCloseAt=false&pageSize=100`,
        { token: adminToken },
      );
      expect(undatedList.status()).toBe(200);
      const undatedBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(undatedList);
      expect((undatedBody?.items ?? []).map((item) => item.id).sort(), 'hasExpectedCloseAt=false returns only undated deals').toEqual(
        [undatedId, undatedWonId].sort(),
      );
      void nextId;
      void overdueId;
    } finally {
      for (const id of createdDeals) {
        await deleteEntityIfExists(request, adminToken, DEALS_PATH, id);
      }
      for (const id of stageIds) {
        await deleteEntityByBody(request, adminToken, STAGES_PATH, id);
      }
      await deleteEntityByBody(request, adminToken, PIPELINES_PATH, pipelineId);
      await deleteEntityByBody(request, adminToken, PIPELINES_PATH, otherPipelineId);
    }
  });

  test('does not leak deals from another organization', async ({ request }) => {
    test.slow();
    const stamp = Date.now();
    const org2Email = `tc-crm-tl-001-org2-${stamp}@example.com`;
    const adminToken = await getAuthToken(request, 'admin');
    const superToken = await getAuthToken(request, 'superadmin');
    const { tenantId } = getTokenContext(adminToken);
    let org2Id: string | null = null;
    let user2Id: string | null = null;
    let user2Token: string | null = null;
    let deal2Id: string | null = null;
    const todayKey = toUtcDateKey(new Date()) as string;
    const from = addBuckets(alignToBucketStart(todayKey, 'week'), 'week', 1);

    try {
      org2Id = await createOrganizationFixture(request, superToken, { name: `TC-CRM-TL-001 Org2 ${stamp}`, tenantId });
      user2Id = await createUserFixture(request, superToken, {
        email: org2Email,
        password: PASSWORD,
        organizationId: org2Id,
        roles: [],
      });
      await setUserAclVisibility(request, superToken, { userId: user2Id, organizations: null, features: ['customers.*'] });
      user2Token = await getAuthToken(request, org2Email, PASSWORD);
      deal2Id = await createDealFixture(request, user2Token, {
        title: `TC-CRM-TL-001 Org2 Deal ${stamp}`,
        status: 'open',
        expectedCloseAt: closeAt(addDays(from, 2)),
        ownerUserId: user2Id,
      });

      const query = `bucket=week&from=${from}&columns=2&ownerUserId=${user2Id}`;
      const own = await fetchTimeline(request, user2Token, query);
      const ownLane = own.lanes.find((lane) => lane.key === user2Id);
      expect(ownLane?.total, 'org2 user sees its own deal').toBe(1);
      expect(allItemIds(own)).toContain(deal2Id);

      const foreign = await fetchTimeline(request, adminToken, query);
      const foreignLane = foreign.lanes.find((lane) => lane.key === user2Id);
      expect(foreignLane?.total ?? 0, 'org1 admin does not count the org2 deal').toBe(0);
      expect(foreign.columns.reduce((sum, column) => sum + column.total, 0), 'no org2 deal in column totals').toBe(0);
      expect(allItemIds(foreign)).not.toContain(deal2Id);
    } finally {
      if (user2Token) await deleteEntityIfExists(request, user2Token, DEALS_PATH, deal2Id);
      await deleteUserIfExists(request, superToken, user2Id);
      await deleteOrganizationIfExists(request, superToken, org2Id);
    }
  });

  test('rejects invalid queries with 400', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    for (const query of ['bucket=day', 'columns=9', 'from=2026-13-01', 'perCell=0', 'cellLane=__unassigned']) {
      const response = await apiRequest(request, 'GET', `${TIMELINE_PATH}?${query}`, { token });
      expect(response.status(), `${query} → 400`).toBe(400);
    }
    const contradiction = await apiRequest(request, 'GET', `${DEALS_PATH}?hasExpectedCloseAt=false&isOverdue=true`, { token });
    expect(contradiction.status(), 'list hasExpectedCloseAt=false&isOverdue=true → 400').toBe(400);
  });
});
