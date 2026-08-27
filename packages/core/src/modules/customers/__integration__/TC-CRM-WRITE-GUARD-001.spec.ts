import { test, expect } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  createDealFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-WRITE-GUARD-001: a write endpoint applies a field or refuses it.
 * Spec: .ai/specs/2026-08-26-write-payload-silent-field-drop.md
 *
 * These endpoints used to answer `200 {"ok":true}` while discarding part of the
 * body, so a caller could not tell "written" from "ignored" without reading the
 * record back. Each case below asserts the outcome over the wire, then re-reads
 * the record, because the response alone was exactly what could not be trusted.
 */
test.describe('TC-CRM-WRITE-GUARD-001: writes never silently discard a field', () => {
  test('a deal update sent in the snake_case spelling the list emits is applied', async ({ request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA WG001 Co ${stamp}`);
      dealId = await createDealFixture(request, token, {
        title: `QA WG001 Deal ${stamp}`,
        companyIds: [companyId],
      });

      // Exactly the shape a caller gets back from GET /api/customers/deals.
      const res = await apiRequest(request, 'PUT', '/api/customers/deals', {
        token,
        data: {
          id: dealId,
          status: 'closed',
          closure_outcome: 'lost',
          loss_notes: 'QA WG001 undercut on price',
        },
      });
      expect(res.status()).toBe(200);

      const detail = await apiRequest(request, 'GET', `/api/customers/deals?id=${dealId}`, { token });
      expect(detail.status()).toBe(200);
      const body = await detail.json();
      const deal = Array.isArray(body?.items) ? body.items[0] : body;

      expect(deal.closure_outcome ?? deal.closureOutcome).toBe('lost');
      expect(deal.loss_notes ?? deal.lossNotes).toBe('QA WG001 undercut on price');
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  test('a deal update naming a field the endpoint cannot write reports it back', async ({ request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA WG001b Co ${stamp}`);
      dealId = await createDealFixture(request, token, {
        title: `QA WG001b Deal ${stamp}`,
        companyIds: [companyId],
      });

      const res = await apiRequest(request, 'PUT', '/api/customers/deals', {
        token,
        data: { id: dealId, status: 'open', not_a_deal_field: 'x' },
      });
      expect(res.status()).toBe(200);

      const payload = await res.json();
      expect(payload.ignoredFields).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: 'not_a_deal_field', reason: 'unknown' })]),
      );
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  // An interaction's owning entity is fixed at creation, so this must be refused
  // rather than accepted and ignored.
  test('an activity update carrying entityId is refused with 400', async ({ request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let otherCompanyId: string | null = null;
    let activityId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA WG001c Co ${stamp}`);
      otherCompanyId = await createCompanyFixture(request, token, `QA WG001c Other ${stamp}`);

      const created = await apiRequest(request, 'POST', '/api/customers/activities', {
        token,
        data: {
          entityId: companyId,
          activityType: 'note',
          subject: `QA WG001c ${stamp}`,
          body: 'created for the write-guard check',
        },
      });
      expect(created.status()).toBe(201);
      activityId = (await created.json())?.id ?? null;
      expect(activityId).toBeTruthy();

      const res = await apiRequest(request, 'PUT', '/api/customers/activities', {
        token,
        data: { id: activityId, entityId: otherCompanyId, subject: `QA WG001c moved ${stamp}` },
      });

      expect(res.status()).toBe(400);
      const payload = await res.json();
      expect(payload.fields).toContain('entityId');
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/activities', activityId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', otherCompanyId);
    }
  });

  // `date`, `time` and `phoneNumber` passed validation and were then left out of
  // the hand-built command input, so the edit reported success and changed nothing.
  test('an activity phone-number edit now persists', async ({ request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let activityId: string | null = null;
    const stamp = Date.now();
    const phone = '+48221234567';

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA WG001d Co ${stamp}`);

      const created = await apiRequest(request, 'POST', '/api/customers/activities', {
        token,
        data: {
          entityId: companyId,
          activityType: 'call',
          subject: `QA WG001d ${stamp}`,
          phoneNumber: '+48229999999',
        },
      });
      expect(created.status()).toBe(201);
      activityId = (await created.json())?.id ?? null;
      expect(activityId).toBeTruthy();

      const res = await apiRequest(request, 'PUT', '/api/customers/activities', {
        token,
        data: { id: activityId, activityType: 'call', phoneNumber: phone },
      });
      expect(res.status()).toBe(200);

      const detail = await apiRequest(request, 'GET', `/api/customers/activities?id=${activityId}`, { token });
      expect(detail.status()).toBe(200);
      const body = await detail.json();
      const activity = Array.isArray(body?.items)
        ? body.items.find((item: { id?: string }) => item?.id === activityId) ?? body.items[0]
        : body;

      expect(activity?.phoneNumber ?? activity?.phone_number).toBe(phone);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/activities', activityId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
