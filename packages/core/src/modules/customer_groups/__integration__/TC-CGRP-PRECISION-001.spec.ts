import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomerGroupFixture,
  deleteCustomerGroupIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers';
import { fixturePriority, uniqueStamp } from './helpers';

/**
 * TC-CGRP-PRECISION-001: group terms (`defaultCreditLimit`, `approvalRequiredAbove`,
 * `minOrderValue`) keep every digit beyond 2 decimals and beyond float precision,
 * exposed as exact `<field>Exact` strings next to the legacy JSON numbers.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 */

const GROUPS_PATH = '/api/customer_groups/customer-groups';

type TermsBody = {
  terms?: {
    updatedAt?: string;
    defaultCreditLimit?: number | null;
    defaultCreditLimitExact?: string | null;
    approvalRequiredAbove?: number | null;
    approvalRequiredAboveExact?: string | null;
    minOrderValue?: number | null;
    minOrderValueExact?: string | null;
    creditCurrencyCode?: string | null;
  } | null;
};

type ExpectedTerms = {
  defaultCreditLimitExact: string;
  approvalRequiredAboveExact: string;
  minOrderValueExact: string;
};

function termsPath(groupId: string): string {
  return `${GROUPS_PATH}/${groupId}/terms`;
}

function significantDigitCount(value: string): number {
  return value.replace(/[^0-9]/g, '').replace(/^0+/, '').length;
}

async function readTerms(request: APIRequestContext, token: string, groupId: string): Promise<TermsBody> {
  const response = await apiRequest(request, 'GET', termsPath(groupId), { token });
  expect(response.status(), 'GET terms should be 200').toBe(200);
  return (await readJsonSafe<TermsBody>(response)) ?? {};
}

function expectExactTerms(body: TermsBody, expected: ExpectedTerms, label: string): void {
  expect(body.terms, `${label}: terms row should be present`).toBeTruthy();
  expect(body.terms?.defaultCreditLimitExact, `${label}: defaultCreditLimitExact`).toBe(
    expected.defaultCreditLimitExact,
  );
  expect(body.terms?.approvalRequiredAboveExact, `${label}: approvalRequiredAboveExact`).toBe(
    expected.approvalRequiredAboveExact,
  );
  expect(body.terms?.minOrderValueExact, `${label}: minOrderValueExact`).toBe(expected.minOrderValueExact);
  expect(body.terms?.defaultCreditLimit, `${label}: legacy number stays a number`).toBe(
    Number(expected.defaultCreditLimitExact),
  );
}

test.describe('TC-CGRP-PRECISION-001: customer group terms beyond 2 decimals', () => {
  test('terms money fields round-trip exactly on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let groupId: string | null = null;

    const created: ExpectedTerms = {
      defaultCreditLimitExact: '12345678901234567.123456789',
      approvalRequiredAboveExact: '0.000000000000000001',
      minOrderValueExact: '98765432109876543210.987654321',
    };
    const updated: ExpectedTerms = {
      defaultCreditLimitExact: '0.000000000000000002',
      approvalRequiredAboveExact: '99999999999999999.999999999',
      minOrderValueExact: created.minOrderValueExact,
    };

    expect(significantDigitCount(created.defaultCreditLimitExact)).toBeGreaterThan(16);
    expect(significantDigitCount(created.minOrderValueExact)).toBeGreaterThan(16);
    expect(significantDigitCount(updated.approvalRequiredAboveExact)).toBeGreaterThan(16);
    expect(String(Number(created.defaultCreditLimitExact))).not.toBe(created.defaultCreditLimitExact);

    try {
      groupId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-precision-${stamp}`,
        name: `QA CGRP Precision ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 7),
      });

      const createResponse = await apiRequest(request, 'PUT', termsPath(groupId), {
        token,
        data: {
          defaultCreditLimit: created.defaultCreditLimitExact,
          creditCurrencyCode: 'USD',
          approvalRequiredAbove: created.approvalRequiredAboveExact,
          minOrderValue: created.minOrderValueExact,
        },
      });
      expect(createResponse.status(), 'first PUT terms should be 200').toBe(200);
      const createBody = (await readJsonSafe<TermsBody>(createResponse)) ?? {};
      expectExactTerms(createBody, created, 'create response');

      const afterCreate = await readTerms(request, token, groupId);
      expectExactTerms(afterCreate, created, 'read after create');
      expect(afterCreate.terms?.creditCurrencyCode).toBe('USD');
      const lockToken = afterCreate.terms?.updatedAt;
      expect(typeof lockToken, 'terms row should expose updatedAt').toBe('string');

      const updateResponse = await apiRequest(request, 'PUT', termsPath(groupId), {
        token,
        data: {
          defaultCreditLimit: updated.defaultCreditLimitExact,
          approvalRequiredAbove: updated.approvalRequiredAboveExact,
        },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: lockToken ?? '' },
      });
      expect(updateResponse.status(), 'second PUT terms should be 200').toBe(200);
      const updateBody = (await readJsonSafe<TermsBody>(updateResponse)) ?? {};
      expectExactTerms(updateBody, updated, 'update response');

      const afterUpdate = await readTerms(request, token, groupId);
      expectExactTerms(afterUpdate, updated, 'read after update');
      expect(afterUpdate.terms?.creditCurrencyCode).toBe('USD');

      const oversizedResponse = await apiRequest(request, 'PUT', termsPath(groupId), {
        token,
        data: { defaultCreditLimit: 1e305 },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: afterUpdate.terms?.updatedAt ?? '' },
      });
      expect(oversizedResponse.status(), 'an oversized credit limit should be rejected, not cleared').toBe(400);

      const afterOversized = await readTerms(request, token, groupId);
      expectExactTerms(afterOversized, updated, 'read after rejected oversized update');
    } finally {
      await deleteCustomerGroupIfExists(request, token, groupId);
    }
  });
});
