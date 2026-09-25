import { expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiRequest } from './api';
import { expectId, readJsonSafe } from './generalFixtures';
import { withClient } from './dbFixtures';

/**
 * Fixtures for the `ledger` module's integration tests.
 *
 * `postJournalEntry`/`reverseJournalEntry` have no HTTP route in Phase 1 — see
 * `.ai/specs/2026-08-18-general-ledger-core-engine.md`, API Contracts:
 * "No POST/PUT/DELETE on this route — posting only happens through
 * postJournalEntry/reverseJournalEntry", and Design decisions: "every posting
 * in Phase 1 comes from postJournalEntry called programmatically by a
 * downstream integration". A `JournalEntry` fixture therefore cannot be
 * created through the API the way a currency or fiscal period can, so
 * `seedJournalEntryInDb` inserts it (and its balanced lines) directly via
 * `pg`, inside one explicit transaction — the same rationale `dbFixtures.ts`
 * documents for entities with no create-via-API path. This does not exercise
 * `postJournalEntry` itself (that's the module's own Jest unit suite and
 * the Cucumber BDD scenarios); it only seeds rows for
 * `GET /api/ledger/journal-entries` to read back.
 */

export async function createFiscalPeriodFixture(
  request: APIRequestContext,
  token: string,
  input: { organizationId: string; tenantId: string; startDate: string; endDate: string },
  opts: { headers?: Record<string, string> } = {},
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/ledger/fiscal-periods', {
    token,
    data: input,
    headers: opts.headers,
  });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), `Failed to create fiscal period fixture: ${response.status()} ${JSON.stringify(body)}`).toBe(201);
  return expectId(body?.id, 'Fiscal period creation response should include id');
}

export async function getFiscalPeriod(
  request: APIRequestContext,
  token: string,
  id: string,
  opts: { headers?: Record<string, string> } = {},
): Promise<{ id: string; isLocked: boolean; updatedAt: string | null }> {
  const response = await apiRequest(request, 'GET', `/api/ledger/fiscal-periods?id=${encodeURIComponent(id)}`, {
    token,
    headers: opts.headers,
  });
  expect(response.status(), `GET fiscal-periods?id=${id} should return 200`).toBe(200);
  const body = (await response.json()) as { items?: Array<{ id: string; isLocked: boolean; updatedAt: string | null }> };
  const item = (body.items ?? [])[0];
  expect(item, `fiscal period ${id} should be returned`).toBeTruthy();
  return item as { id: string; isLocked: boolean; updatedAt: string | null };
}

export async function createAccountTypeFixture(
  request: APIRequestContext,
  token: string,
  input: {
    organizationId: string;
    tenantId: string;
    slug: string;
    name: string;
    normalBalance: 'DEBIT' | 'CREDIT';
  },
  opts: { headers?: Record<string, string> } = {},
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/ledger/account-types', {
    token,
    data: input,
    headers: opts.headers,
  });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), `Failed to create ledger account type fixture: ${response.status()} ${JSON.stringify(body)}`).toBe(201);
  return expectId(body?.id, 'Ledger account type creation response should include id');
}

export async function createAccountFixture(
  request: APIRequestContext,
  token: string,
  input: { organizationId: string; tenantId: string; slug: string; accountTypeId: string; description?: string },
  opts: { headers?: Record<string, string> } = {},
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/ledger/accounts', {
    token,
    data: input,
    headers: opts.headers,
  });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), `Failed to create ledger account fixture: ${response.status()} ${JSON.stringify(body)}`).toBe(201);
  return expectId(body?.id, 'Ledger account creation response should include id');
}

export type SeedJournalEntryLine = { accountId: string; debit: string; credit: string };

export type SeedJournalEntryInput = {
  organizationId: string;
  tenantId: string;
  currencyId: string;
  operationDate: string; // YYYY-MM-DD
  lines: SeedJournalEntryLine[];
  sequenceNumber?: number;
  description?: string;
  type?: 'NORMAL' | 'OPENING' | 'CLOSING' | 'REVERSAL';
  referenceType?: string | null;
  referenceId?: string | null;
};

/**
 * Inserts a `JournalEntry` + its `JournalEntryLine` rows directly in Postgres,
 * inside one explicit transaction, so the deferred `journal_entry_line_balanced`
 * constraint trigger (checked at COMMIT, not per-row) sees the fully-balanced
 * set of lines rather than rejecting the first row in isolation. Callers are
 * responsible for passing lines that actually balance (sum(debit) ==
 * sum(credit)) — this fixture does not validate that itself, unlike the real
 * `postJournalEntry` command.
 */
export async function seedJournalEntryInDb(input: SeedJournalEntryInput): Promise<string> {
  const entryId = randomUUID();
  const sequenceNumber = input.sequenceNumber ?? Date.now();
  return withClient(async (client) => {
    await client.query('begin');
    try {
      await client.query(
        `insert into journal_entries
           (id, organization_id, tenant_id, sequence_number, posted_at, operation_date,
            document_type, document_number, document_date, description, type,
            currency_id, exchange_rate, reference_type, reference_id)
         values ($1, $2, $3, $4, now(), $5, null, null, null, $6, $7, $8, null, $9, $10)`,
        [
          entryId,
          input.organizationId,
          input.tenantId,
          sequenceNumber,
          input.operationDate,
          input.description ?? 'QA seeded journal entry',
          input.type ?? 'NORMAL',
          input.currencyId,
          input.referenceType ?? null,
          input.referenceId ?? null,
        ],
      );
      for (const line of input.lines) {
        await client.query(
          `insert into journal_entry_lines
             (id, organization_id, tenant_id, journal_entry_id, account_id, debit, credit, amount_currency, contractor_snapshot)
           values ($1, $2, $3, $4, $5, $6, $7, $8, null)`,
          [randomUUID(), input.organizationId, input.tenantId, entryId, line.accountId, line.debit, line.credit, '0'],
        );
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    }
    return entryId;
  });
}

/**
 * Best-effort cleanup for `seedJournalEntryInDb` — deletes lines, then the
 * entry. PR #6340 review, N1: this used to target the pre-rename singular
 * tables (`journal_entry`/`journal_entry_line`), so every call threw
 * `relation "journal_entry" does not exist` — silently, because the whole
 * function is wrapped in a best-effort `catch {}`. Even against the correct
 * plural tables, a plain DELETE would still fail: `journal_entries_append_only`
 * / `journal_entry_lines_append_only` (added for m6) block UPDATE/DELETE on
 * both tables by design, since a posted journal entry must never be mutated
 * or removed. Both triggers are disabled for the span of this one
 * transaction (`ALTER TABLE ... DISABLE TRIGGER` is transactional DDL, so a
 * rollback restores them) and re-enabled before commit — this only ever
 * touches rows this same fixture inserted directly via SQL in
 * `seedJournalEntryInDb`, never anything posted through the real
 * `postJournalEntry`/`reverseJournalEntry` commands, which have no reason to
 * bypass the append-only guarantee.
 */
export async function deleteJournalEntryInDb(entryId: string | null): Promise<void> {
  if (!entryId) return;
  try {
    await withClient(async (client) => {
      await client.query('begin');
      try {
        await client.query('alter table "journal_entry_lines" disable trigger "journal_entry_lines_append_only"');
        await client.query('alter table "journal_entries" disable trigger "journal_entries_append_only"');
        await client.query('delete from journal_entry_lines where journal_entry_id = $1', [entryId]);
        await client.query('delete from journal_entries where id = $1', [entryId]);
        // The DELETE above queues a pending event for the deferred
        // `journal_entry_lines_balanced` constraint trigger; Postgres
        // refuses `ALTER TABLE ... ENABLE TRIGGER` on that table while an
        // event is still pending (confirmed against a real Postgres:
        // "cannot ALTER TABLE ... because it has pending trigger events").
        // Forcing it to fire now is safe — no lines remain for this entry,
        // so the balance check is vacuously satisfied.
        await client.query('set constraints "journal_entry_lines_balanced" immediate');
        await client.query('alter table "journal_entry_lines" enable trigger "journal_entry_lines_append_only"');
        await client.query('alter table "journal_entries" enable trigger "journal_entries_append_only"');
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      }
    });
  } catch {
    // best-effort
  }
}
