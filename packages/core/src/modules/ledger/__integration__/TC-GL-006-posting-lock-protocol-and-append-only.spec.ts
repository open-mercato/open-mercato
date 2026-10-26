import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import { deleteGeneralEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCurrencyFixture,
  generateUniqueCurrencyCode,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/helpers/integration/currenciesFixtures';
import {
  createAccountFixture,
  createAccountTypeFixture,
  createFiscalPeriodFixture,
  seedAccountGroupInDb,
  seedJournalEntryInDb,
} from '@open-mercato/core/helpers/integration/ledgerFixtures';

/**
 * TC-GL-006: the lock protocol between posting and the commands that change
 * an account or an account type, and the append-only trigger.
 *
 * Posting takes `for share` on every account it touches and holds it until it
 * commits. `updateLedgerAccount` and `updateLedgerAccountType` take `for
 * update` on the account row (the type row, then its accounts) before they
 * check "has posted entries", so a check and a post cannot both act on a
 * stale snapshot. Jest and BDD run against an in-memory fake with no real
 * locks, so this is the only place the protocol is exercised for real:
 *
 *   1. A second connection plays the posting in flight: it opens a
 *      transaction, locks the accounts `for share`, inserts the entry and its
 *      lines, and keeps the transaction open.
 *   2. The update goes through the real API route. It cannot finish while
 *      the post is uncommitted, so it is still pending after a short wait.
 *      (This only shows that the update is blocked somewhere; the old code
 *      blocked too, on its final UPDATE of the account row.)
 *   3. The post commits. The update must then answer 409: it ran its "has
 *      posted entries" check after the lock was granted and saw the committed
 *      lines. This is the assertion that separates the protocol from the old
 *      code, which ran the check before waiting, against a snapshot that did
 *      not contain the in-flight lines, and so changed the number of an
 *      account that had posted lines (200).
 *
 * The last test checks the append-only trigger on `journal_entries` and
 * `journal_entry_lines` against the real database.
 */

const WAIT_MS = 1500;

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

type Fixture = {
  token: string;
  tenantId: string;
  organizationId: string;
  currencyId: string;
  headers: Record<string, string>;
  typeId: string;
  cashId: string;
  otherId: string;
  putAccount: (data: Record<string, unknown>) => ReturnType<typeof apiRequest>;
  putType: (data: Record<string, unknown>) => ReturnType<typeof apiRequest>;
  cleanup: () => Promise<void>;
};

async function createFixture(request: APIRequestContext, label: string): Promise<Fixture> {
  const token = await getAuthToken(request, 'superadmin');
  const stamp = randomUUID();
  const tenantId = await createTenant(request, token, `QA ${label} Tenant ${stamp}`);
  const organizationId = await createOrganizationFixture(request, token, {
    name: `QA ${label} Organization ${stamp}`,
    tenantId,
  });
  const scope = { tenantId, organizationId };
  const headers = scopedHeaders(scope);
  const currencyId = await createCurrencyFixture(request, token, {
    code: generateUniqueCurrencyCode(),
    name: `QA ${label} Currency`,
    organizationId,
    tenantId,
    headers,
  });
  await createFiscalPeriodFixture(
    request,
    token,
    { organizationId, tenantId, startDate: '2034-01-01', endDate: '2034-12-31' },
    { headers },
  );
  const groupId = await seedAccountGroupInDb({ ...scope, code: '4', name: 'QA group 4' });
  const typeId = await createAccountTypeFixture(
    request,
    token,
    { ...scope, number: '402', name: 'QA expenses by nature', normalBalance: 'DEBIT', accountGroupId: groupId },
    { headers },
  );
  const cashId = await createAccountFixture(request, token, { ...scope, number: '402-01', accountTypeId: typeId }, { headers });
  const otherId = await createAccountFixture(request, token, { ...scope, number: '402-03', accountTypeId: typeId }, { headers });
  return {
    token,
    tenantId,
    organizationId,
    currencyId,
    headers,
    typeId,
    cashId,
    otherId,
    putAccount: (data) => apiRequest(request, 'PUT', '/api/ledger/accounts', { token, headers, data }),
    putType: (data) => apiRequest(request, 'PUT', '/api/ledger/account-types', { token, headers, data }),
    cleanup: async () => {
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId, { headers }).catch(() => undefined);
      await deleteOrganizationIfExists(request, token, organizationId);
      await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', tenantId);
    },
  };
}

/**
 * Starts `send()` while a posting is in flight, checks that it is still
 * waiting after WAIT_MS, lets the post commit and returns what `send()`
 * answered. The promise is created inside the open transaction on purpose.
 */
async function updateWhilePostIsInFlight(
  fx: Fixture,
  send: () => ReturnType<typeof apiRequest>,
): Promise<Awaited<ReturnType<typeof apiRequest>>> {
  let pending: ReturnType<typeof apiRequest> | null = null;
  let settled = false;
  await seedJournalEntryInDb(
    {
      organizationId: fx.organizationId,
      tenantId: fx.tenantId,
      currencyId: fx.currencyId,
      operationDate: '2034-03-10',
      lines: [
        { accountId: fx.cashId, debit: '75.0000', credit: '0' },
        { accountId: fx.otherId, debit: '0', credit: '75.0000' },
      ],
    },
    {
      lockAccountIds: [fx.cashId, fx.otherId],
      whileOpen: async () => {
        pending = send();
        pending.then(
          () => { settled = true; },
          () => { settled = true; },
        );
        await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
        expect(settled, 'the update is blocked while the post is uncommitted').toBe(false);
      },
    },
  );
  return (pending as unknown as ReturnType<typeof apiRequest>);
}

test.describe('TC-GL-006: posting lock protocol and append-only entries', () => {
  test('an account number change waits for an in-flight post and is rejected once it commits', async ({ request }) => {
    const fx = await createFixture(request, 'TC-GL-006 account');
    try {
      const response = await updateWhilePostIsInFlight(fx, () => fx.putAccount({ id: fx.cashId, number: '402-09' }));
      expect(response.status(), 'the post won the race, so the number is frozen (409)').toBe(409);

      const after = await apiRequest(request, 'GET', `/api/ledger/accounts?id=${encodeURIComponent(fx.cashId)}`, {
        token: fx.token,
        headers: fx.headers,
      });
      const body = (await after.json()) as { items?: Array<{ number?: string }> };
      expect(body.items?.[0]?.number, 'the number is unchanged').toBe('402-01');
    } finally {
      await fx.cleanup();
    }
  });

  test('a type number change waits for an in-flight post to one of its accounts and is rejected once it commits', async ({ request }) => {
    const fx = await createFixture(request, 'TC-GL-006 type');
    try {
      const response = await updateWhilePostIsInFlight(fx, () => fx.putType({ id: fx.typeId, number: '411' }));
      expect(response.status(), 'the post won the race, so the type number is frozen (409)').toBe(409);

      const accounts = await apiRequest(request, 'GET', `/api/ledger/accounts?id=${encodeURIComponent(fx.cashId)}`, {
        token: fx.token,
        headers: fx.headers,
      });
      const body = (await accounts.json()) as { items?: Array<{ number?: string }> };
      expect(body.items?.[0]?.number, 'no account was renumbered by the rejected update').toBe('402-01');
    } finally {
      await fx.cleanup();
    }
  });

  test('journal entries and their lines are append-only in the database', async ({ request }) => {
    const fx = await createFixture(request, 'TC-GL-006 append-only');
    try {
      const entryId = await seedJournalEntryInDb({
        organizationId: fx.organizationId,
        tenantId: fx.tenantId,
        currencyId: fx.currencyId,
        operationDate: '2034-03-11',
        lines: [
          { accountId: fx.cashId, debit: '10.0000', credit: '0' },
          { accountId: fx.otherId, debit: '0', credit: '10.0000' },
        ],
      });

      await withClient(async (client) => {
        await expect(
          client.query('update journal_entries set description = $1 where id = $2', ['tampered', entryId]),
        ).rejects.toThrow(/append-only/);
        await expect(client.query('delete from journal_entries where id = $1', [entryId])).rejects.toThrow(/append-only/);
        await expect(
          client.query('update journal_entry_lines set debit = debit + 1 where journal_entry_id = $1', [entryId]),
        ).rejects.toThrow(/append-only/);
        await expect(
          client.query('delete from journal_entry_lines where journal_entry_id = $1', [entryId]),
        ).rejects.toThrow(/append-only/);

        const header = await client.query<{ description: string }>('select description from journal_entries where id = $1', [entryId]);
        expect(header.rows[0]?.description).not.toBe('tampered');
        const lines = await client.query<{ n: string }>('select count(*)::text as n from journal_entry_lines where journal_entry_id = $1', [entryId]);
        expect(lines.rows[0]?.n).toBe('2');
      });
    } finally {
      await fx.cleanup();
    }
  });
});
