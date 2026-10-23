import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader';
import { createRequestContainer } from '@open-mercato/shared/lib/di/container';
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus';
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot';
import { createOrganizationFixture, deleteOrganizationIfExists } from '@open-mercato/core/helpers/integration/authFixtures';
import {
  createCurrencyFixture,
  deleteCurrenciesEntityIfExists,
  generateUniqueCurrencyCode,
} from '@open-mercato/core/helpers/integration/currenciesFixtures';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createAccountFixture,
  createAccountTypeFixture,
  createFiscalPeriodFixture,
  seedJournalEntryInDb,
} from '@open-mercato/core/helpers/integration/ledgerFixtures';

/**
 * TC-JELD-001: `journal_entry_line_dimensions.dimensions.set` against a real
 * database — tagging a ledger line, undoing the change, and organization
 * isolation.
 *
 * The command has no HTTP route in Phase 1 (spec: "there is no HTTP route or
 * form behind it"), so the spec runs it through the app's own command bus
 * in-process, the way TC-AUTH-066 drives `commandBus.execute`/`undo`. The
 * ledger line it tags is seeded with `seedJournalEntryInDb` because
 * `postJournalEntry` has no route either; the fiscal period, accounts and
 * currency go through their API routes. Everything lives under a throwaway
 * tenant with two organizations, removed in `afterAll`.
 */

const COMMAND_ID = 'journal_entry_line_dimensions.dimensions.set';

type Fixture = {
  tenantId: string;
  organizationAId: string;
  organizationBId: string;
  actorUserId: string;
  lineId: string;
  currencyId: string;
  accountTypeId: string;
  accountIds: string[];
  headers: Record<string, string>;
};

type DimensionRow = { dimension_id: string; writer: string; organization_id: string };

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201);
  return expectId(body?.id, 'Tenant creation response should include id');
}

function scopedHeaders(tenantId: string, organizationId: string): Record<string, string> {
  return {
    Cookie: [
      `om_selected_tenant=${encodeURIComponent(tenantId)}`,
      `om_selected_org=${encodeURIComponent(organizationId)}`,
    ].join('; '),
  };
}

async function dimensionRows(lineId: string, tenantId: string): Promise<DimensionRow[]> {
  return withClient(async (client) => {
    const result = await client.query<DimensionRow>(
      `select dimension_id, writer, organization_id
         from journal_entry_line_dimensions
        where journal_entry_line_id = $1 and tenant_id = $2
        order by dimension_id`,
      [lineId, tenantId],
    );
    return result.rows;
  });
}

async function commandBusContext(): Promise<{ commandBus: CommandBus; container: CommandRuntimeContext['container'] }> {
  await bootstrapFromAppRoot(resolveAppRoot());
  const container = await createRequestContainer();
  return { commandBus: container.resolve('commandBus') as CommandBus, container };
}

function actorContext(
  container: CommandRuntimeContext['container'],
  fixture: Fixture,
  organizationId: string,
): CommandRuntimeContext {
  return {
    container,
    auth: { sub: fixture.actorUserId, tenantId: fixture.tenantId, orgId: organizationId },
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  };
}

test.describe.serial('TC-JELD-001: set, undo and organization isolation', () => {
  let fixture: Fixture | null = null;
  let superadminToken = '';

  test.beforeAll(async ({ request }) => {
    superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID().slice(0, 8);
    const tenantId = await createTenant(request, superadminToken, `QA TC-JELD-001 Tenant ${stamp}`);
    const organizationAId = await createOrganizationFixture(request, superadminToken, {
      name: `QA TC-JELD-001 Organization A ${stamp}`,
      tenantId,
    });
    const organizationBId = await createOrganizationFixture(request, superadminToken, {
      name: `QA TC-JELD-001 Organization B ${stamp}`,
      tenantId,
    });
    const headers = scopedHeaders(tenantId, organizationAId);
    const currencyId = await createCurrencyFixture(request, superadminToken, {
      code: generateUniqueCurrencyCode(),
      name: 'QA TC-JELD-001 Currency',
      organizationId: organizationAId,
      tenantId,
      headers,
    });
    await createFiscalPeriodFixture(
      request,
      superadminToken,
      { organizationId: organizationAId, tenantId, startDate: '2032-03-01', endDate: '2032-03-31' },
      { headers },
    );
    const accountTypeId = await createAccountTypeFixture(
      request,
      superadminToken,
      {
        organizationId: organizationAId,
        tenantId,
        number: `qa-jeld-type-${stamp}`,
        name: 'QA TC-JELD-001 Account Type',
        normalBalance: 'DEBIT',
      },
      { headers },
    );
    const debitAccountId = await createAccountFixture(
      request,
      superadminToken,
      { organizationId: organizationAId, tenantId, number: `qa-jeld-dr-${stamp}`, accountTypeId },
      { headers },
    );
    const creditAccountId = await createAccountFixture(
      request,
      superadminToken,
      { organizationId: organizationAId, tenantId, number: `qa-jeld-cr-${stamp}`, accountTypeId },
      { headers },
    );
    const entryId = await seedJournalEntryInDb({
      organizationId: organizationAId,
      tenantId,
      currencyId,
      operationDate: '2032-03-15',
      lines: [
        { accountId: debitAccountId, debit: '10.0000', credit: '0' },
        { accountId: creditAccountId, debit: '0', credit: '10.0000' },
      ],
    });
    const lineId = await withClient(async (client) => {
      const result = await client.query<{ id: string }>(
        'select id from journal_entry_lines where journal_entry_id = $1 order by debit desc limit 1',
        [entryId],
      );
      return expectId(result.rows[0]?.id, 'Seeded journal entry should have a line');
    });
    fixture = {
      tenantId,
      organizationAId,
      organizationBId,
      actorUserId: expectId(getTokenScope(superadminToken).userId, 'Superadmin token should include user id'),
      lineId,
      currencyId,
      accountTypeId,
      accountIds: [debitAccountId, creditAccountId],
      headers,
    };
  });

  test.afterAll(async ({ request }) => {
    if (!fixture) return;
    const { tenantId, organizationAId, organizationBId, headers } = fixture;
    await withClient(async (client) => {
      await client.query('delete from journal_entry_line_dimensions where tenant_id = $1', [tenantId]);
      await client.query('delete from action_logs where tenant_id = $1', [tenantId]);
    });
    for (const accountId of fixture.accountIds) {
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/ledger/accounts', accountId, { headers });
    }
    await deleteGeneralEntityIfExists(request, superadminToken, '/api/ledger/account-types', fixture.accountTypeId, { headers });
    await deleteCurrenciesEntityIfExists(request, superadminToken, '/api/currencies/currencies', fixture.currencyId, { headers });
    await deleteOrganizationIfExists(request, superadminToken, organizationAId);
    await deleteOrganizationIfExists(request, superadminToken, organizationBId);
    await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId);
  });

  test('tags a ledger line with a cost centre owned by the calling writer', async () => {
    test.slow();
    const current = fixture!;
    const { commandBus, container } = await commandBusContext();
    const costCenterId = randomUUID();

    await commandBus.execute(COMMAND_ID, {
      input: {
        journalEntryLineId: current.lineId,
        dimensionType: 'CostCenter',
        writer: 'posting_rules',
        dimensionIds: [costCenterId],
      },
      ctx: actorContext(container, current, current.organizationAId),
    });

    expect(await dimensionRows(current.lineId, current.tenantId)).toEqual([
      { dimension_id: costCenterId, writer: 'posting_rules', organization_id: current.organizationAId },
    ]);
  });

  test('undo restores the cost centre the line carried before the change', async () => {
    test.slow();
    const current = fixture!;
    const { commandBus, container } = await commandBusContext();
    const ctx = actorContext(container, current, current.organizationAId);
    const previousCostCenterId = randomUUID();
    await commandBus.execute(COMMAND_ID, {
      input: {
        journalEntryLineId: current.lineId,
        dimensionType: 'CostCenter',
        writer: 'posting_rules',
        dimensionIds: [previousCostCenterId],
      },
      ctx,
    });

    const { logEntry } = await commandBus.execute(COMMAND_ID, {
      input: {
        journalEntryLineId: current.lineId,
        dimensionType: 'CostCenter',
        writer: 'posting_rules',
        dimensionIds: [randomUUID()],
      },
      ctx,
    });
    const undoToken = (logEntry as { undoToken?: string } | null)?.undoToken;
    expect(undoToken, 'the set command should be undoable').toBeTruthy();

    await commandBus.undo(undoToken!, ctx);

    expect(await dimensionRows(current.lineId, current.tenantId)).toEqual([
      { dimension_id: previousCostCenterId, writer: 'posting_rules', organization_id: current.organizationAId },
    ]);
  });

  test('two concurrent calls for the line leave one complete set, never the union of both', async () => {
    test.slow();
    const current = fixture!;
    const first = await commandBusContext();
    const second = await commandBusContext();
    const firstSet = [randomUUID(), randomUUID()].sort();
    const secondSet = [randomUUID()];
    const run = (bus: { commandBus: CommandBus; container: CommandRuntimeContext['container'] }, dimensionIds: string[]) =>
      bus.commandBus.execute(COMMAND_ID, {
        input: { journalEntryLineId: current.lineId, dimensionType: 'CostCenter', writer: 'posting_rules', dimensionIds },
        ctx: actorContext(bus.container, current, current.organizationAId),
      });

    await Promise.all([run(first, firstSet), run(second, secondSet)]);

    const ids = (await dimensionRows(current.lineId, current.tenantId)).map((row) => row.dimension_id);
    expect([firstSet, secondSet]).toContainEqual(ids);
  });

  test('keeps organizations apart: another organization can neither tag the line nor be targeted through the input', async () => {
    test.slow();
    const current = fixture!;
    const { commandBus, container } = await commandBusContext();
    const before = await dimensionRows(current.lineId, current.tenantId);
    const input = {
      journalEntryLineId: current.lineId,
      dimensionType: 'CostCenter',
      writer: 'posting_rules',
      dimensionIds: [randomUUID()],
    };

    await expect(
      commandBus.execute(COMMAND_ID, { input, ctx: actorContext(container, current, current.organizationBId) }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      commandBus.execute(COMMAND_ID, {
        input: { ...input, organizationId: current.organizationBId },
        ctx: actorContext(container, current, current.organizationAId),
      }),
    ).rejects.toMatchObject({ status: 403 });

    const after = await dimensionRows(current.lineId, current.tenantId);
    expect(after).toEqual(before);
    expect(after.every((row) => row.organization_id === current.organizationAId)).toBe(true);
  });
});
