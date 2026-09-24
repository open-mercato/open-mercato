import { test, expect } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createCompanyFixture,
  createDealFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures';

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

  for (const resource of ['activities', 'interactions'] as const) {
    const endpoint = `/api/customers/${resource}`;

    for (const scenario of ['persist', 'conflict', 'clear'] as const) {
      test(`${resource}: phone-number ${scenario} uses the existing custom field`, async ({ request }) => {
        let token: string | null = null;
        let companyId: string | null = null;
        let activityId: string | null = null;
        const initialPhone = '+48229999999';
        const phone = '+48221234567';

        try {
          token = await getAuthToken(request);
          companyId = await createCompanyFixture(request, token, `QA WG001 phone ${resource} ${scenario} ${Date.now()}`);
          const created = await apiRequest(request, 'POST', endpoint, {
            token,
            data: {
              entityId: companyId,
              ...(resource === 'activities'
                ? { activityType: 'call', subject: 'QA WG001 phone' }
                : { interactionType: 'call', title: 'QA WG001 phone' }),
              phoneNumber: initialPhone,
              customValues: { callDirection: 'inbound' },
            },
          });
          expect(created.status()).toBe(201);
          activityId = (await created.json())?.id ?? null;
          expect(activityId).toBeTruthy();

          const readActivity = async () => {
            if (!token) throw new Error('[internal] Test authentication is missing');
            const detail = await apiRequest(request, 'GET', `${endpoint}?entityId=${companyId}`, { token });
            expect(detail.status()).toBe(200);
            const body = await detail.json();
            const activity = body.items.find((item: { id: string }) => item.id === activityId);
            expect(activity).toBeDefined();
            return activity;
          };
          expect((await readActivity()).customValues).toMatchObject({
            callPhoneNumber: initialPhone, callDirection: 'inbound',
          });

          if (scenario === 'persist') {
            const updated = await apiRequest(request, 'PUT', endpoint, {
              token,
              data: { id: activityId, phoneNumber: phone },
            });
            expect(updated.status()).toBe(200);
            expect((await readActivity()).customValues).toMatchObject({
              callPhoneNumber: phone, callDirection: 'inbound',
            });
            const duplicate = await apiRequest(request, 'PUT', endpoint, {
              token,
              data: { id: activityId, phoneNumber: phone, customValues: { callPhoneNumber: phone } },
            });
            expect(duplicate.status()).toBe(200);
            const unrelated = await apiRequest(request, 'PUT', endpoint, {
              token, data: { id: activityId, body: 'Phone omitted deliberately' },
            });
            expect(unrelated.status()).toBe(200);
            expect((await readActivity()).customValues.callPhoneNumber).toBe(phone);
          } else if (scenario === 'conflict') {
            const rejected = await apiRequest(request, 'PUT', endpoint, {
              token,
              data: { id: activityId, phoneNumber: phone, customValues: { callPhoneNumber: initialPhone } },
            });
            expect(rejected.status()).toBe(400);
            expect((await rejected.json()).fields).toContain('phoneNumber');
            expect((await readActivity()).customValues.callPhoneNumber).toBe(initialPhone);
          } else {
            const cleared = await apiRequest(request, 'PUT', endpoint, {
              token, data: { id: activityId, phoneNumber: null },
            });
            expect(cleared.status()).toBe(200);
            const custom = (await readActivity()).customValues;
            expect(custom.callPhoneNumber ?? null).toBeNull();
            expect(custom.callDirection).toBe('inbound');
          }
        } finally {
          await deleteEntityIfExists(request, token, endpoint, activityId);
          await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
        }
      });
    }
  }
});
