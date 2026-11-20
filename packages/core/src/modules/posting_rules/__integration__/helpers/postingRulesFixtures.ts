import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/helpers/integration/api';
import { createOrganizationFixture, deleteOrganizationIfExists } from '@open-mercato/core/helpers/integration/authFixtures';
import { deleteGeneralEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCurrencyFixture,
  deleteCurrenciesEntityIfExists,
  generateUniqueCurrencyCode,
} from '@open-mercato/core/helpers/integration/currenciesFixtures';
import { createAccountFixture, createFiscalPeriodFixture, seedAccountGroupInDb } from '@open-mercato/core/helpers/integration/ledgerFixtures';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';

/**
 * Shared fixtures for the posting_rules integration specs (TC-PR-002+).
 * A throwaway organization gets neither ledger's seeded account groups nor
 * this module's sentinel cost centre (see TC-PR-001's header comment), so
 * `createPostingRulesOrg` builds the minimum chart a reclassification needs
 * through the real routes, seeding only the account groups (no create
 * route) directly.
 */

export const RECLASSIFICATION_REFERENCE_TYPE = 'PostingRulesEngineReclassification';

export const randomSlug = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

export async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201);
  expect(typeof body?.id === 'string' && body.id.length > 0).toBeTruthy();
  return body?.id as string;
}

export function scopedHeaders(scope: { tenantId: string; organizationId: string }): Record<string, string> {
  return {
    Cookie: [
      `om_selected_tenant=${encodeURIComponent(scope.tenantId)}`,
      `om_selected_org=${encodeURIComponent(scope.organizationId)}`,
    ].join('; '),
  };
}

async function createAccountTypeWithGroup(
  request: APIRequestContext,
  token: string,
  headers: Record<string, string>,
  input: { organizationId: string; tenantId: string; number: string; name: string; normalBalance: 'DEBIT' | 'CREDIT'; accountGroupId: string | null },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/ledger/account-types', { token, headers, data: input });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), `Failed to create account type: ${response.status()} ${JSON.stringify(body)}`).toBe(201);
  return body?.id as string;
}

export type PostingRulesOrg = {
  tenantId: string;
  organizationId: string;
  headers: Record<string, string>;
  currencyId: string;
  sourceAccountId: string;
  targetAccountId: string;
  clearingAccountId: string;
  balancingAccountId: string;
  costCenterId: string;
  ruleId: string;
};

/**
 * One organization with: a covering fiscal period for `periodStart..periodEnd`,
 * a zespół 4 source account (401-001, under a PL group-4 type), a zespół 5
 * target account (501-001), an ungrouped clearing account and balancing
 * account, the settings pointing at the clearing account, one explicit cost
 * centre and the 401-001 -> 501-001 rule defaulting to it. Pass `tenantId`
 * to create the organization inside an existing tenant.
 */
export async function createPostingRulesOrg(
  request: APIRequestContext,
  token: string,
  input: { label: string; tenantId?: string; periodStart: string; periodEnd: string },
): Promise<PostingRulesOrg> {
  const tenantId = input.tenantId ?? (await createTenant(request, token, `QA ${input.label} Tenant ${randomUUID()}`));
  const organizationId = await createOrganizationFixture(request, token, {
    name: `QA ${input.label} Organization ${randomUUID()}`,
    tenantId,
  });
  const headers = scopedHeaders({ tenantId, organizationId });
  const scope = { organizationId, tenantId };

  const currencyId = await createCurrencyFixture(request, token, {
    code: generateUniqueCurrencyCode(),
    name: `QA ${input.label} Currency`,
    organizationId,
    tenantId,
    headers,
  });
  await createFiscalPeriodFixture(request, token, { ...scope, startDate: input.periodStart, endDate: input.periodEnd }, { headers });

  const group4 = await seedAccountGroupInDb({ ...scope, jurisdiction: 'PL', code: '4', name: `QA ${input.label} zespół 4` });
  const group5 = await seedAccountGroupInDb({ ...scope, jurisdiction: 'PL', code: '5', name: `QA ${input.label} zespół 5` });
  const type4 = await createAccountTypeWithGroup(request, token, headers, { ...scope, number: '401', name: `QA ${input.label} 4`, normalBalance: 'DEBIT', accountGroupId: group4 });
  const type5 = await createAccountTypeWithGroup(request, token, headers, { ...scope, number: '501', name: `QA ${input.label} 5`, normalBalance: 'DEBIT', accountGroupId: group5 });
  const plainType = await createAccountTypeWithGroup(request, token, headers, { ...scope, number: '900', name: `QA ${input.label} plain`, normalBalance: 'CREDIT', accountGroupId: null });

  const sourceAccountId = await createAccountFixture(request, token, { ...scope, number: '401-001', accountTypeId: type4 }, { headers });
  const targetAccountId = await createAccountFixture(request, token, { ...scope, number: '501-001', accountTypeId: type5 }, { headers });
  const clearingAccountId = await createAccountFixture(request, token, { ...scope, number: '900-001', accountTypeId: plainType }, { headers });
  const balancingAccountId = await createAccountFixture(request, token, { ...scope, number: '900-002', accountTypeId: plainType }, { headers });

  const settingsRes = await apiRequest(request, 'PATCH', '/api/posting_rules/settings', { token, headers, data: { clearingAccountId } });
  expect(settingsRes.status(), 'PATCH settings should return 200').toBe(200);

  const costCenterRes = await apiRequest(request, 'POST', '/api/posting_rules/cost-centers', {
    token,
    headers,
    data: { ...scope, code: randomSlug('QA-CC'), name: `QA ${input.label} Cost Centre` },
  });
  expect(costCenterRes.status(), 'POST cost-centers should return 201').toBe(201);
  const costCenterId = ((await costCenterRes.json()) as { id: string }).id;

  const ruleRes = await apiRequest(request, 'POST', '/api/posting_rules/default-account-posting-rules', {
    token,
    headers,
    data: { ...scope, sourceAccountId, targetAccountId, defaultCostCenterId: costCenterId },
  });
  expect(ruleRes.status(), 'POST default-account-posting-rules should return 201').toBe(201);
  const ruleId = ((await ruleRes.json()) as { id: string }).id;

  return { tenantId, organizationId, headers, currencyId, sourceAccountId, targetAccountId, clearingAccountId, balancingAccountId, costCenterId, ruleId };
}

/** Deletes what `createPostingRulesOrg` created through routes; seeded ledger
 * rows stay behind under the deleted organization (see seedJournalEntryInDb). */
export async function deletePostingRulesOrg(
  request: APIRequestContext,
  token: string,
  org: PostingRulesOrg | null,
  options: { deleteTenant?: boolean } = {},
): Promise<void> {
  if (!org) return;
  await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', org.currencyId);
  await deleteOrganizationIfExists(request, token, org.organizationId);
  if (options.deleteTenant !== false) {
    await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', org.tenantId);
  }
}

export async function getJournalEntryLines(
  entryId: string,
): Promise<Array<{ id: string; accountId: string; debit: string; credit: string }>> {
  return withClient(async (client) => {
    const result = await client.query(
      `select id, account_id as "accountId", debit, credit from journal_entry_lines where journal_entry_id = $1`,
      [entryId],
    );
    return result.rows as Array<{ id: string; accountId: string; debit: string; credit: string }>;
  });
}

/** Reclassification entries keyed on any of `sourceLineIds`. */
export async function countReclassificationsOf(sourceLineIds: string[]): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query(
      `select count(*)::int as count from journal_entries where reference_type = $1 and reference_id = any($2::uuid[])`,
      [RECLASSIFICATION_REFERENCE_TYPE, sourceLineIds],
    );
    return (result.rows[0] as { count: number }).count;
  });
}
