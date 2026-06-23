import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  createPersonFixture,
  createDealFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-CRM-LEAD-001: Lead Creation, Qualification, and Conversion
 *
 * Full flow:
 *   1. Create a lead via API with candidate company/contact fields
 *   2. Verify lead appears in the leads list
 *   3. Open lead detail page, verify candidate fields are displayed
 *   4. Qualify the lead — create person, company, and deal from candidate data
 *   5. Verify all three downstream records were created and linked
 *   6. Verify lead shows conversion lineage (status = qualified, lineage IDs set)
 *   7. Verify converted lead cannot be converted again
 *
 * Cleanup: delete lead, person, company, and deal in teardown.
 */

// ---------------------------------------------------------------------------
// Lead fixture helpers (will move to shared crmFixtures once API is stable)
// ---------------------------------------------------------------------------

type LeadPayload = {
  title: string;
  description?: string;
  source?: string;
  estimatedValueAmount?: number;
  estimatedValueCurrency?: string;
  companyName?: string;
  companyVatId?: string;
  contactFirstName?: string;
  contactLastName?: string;
  contactPhone?: string;
  contactEmail?: string;
};

async function createLeadFixture(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  payload: LeadPayload,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/leads', { token, data: payload });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.ok(), `Failed to create lead: ${response.status()}`).toBeTruthy();
  const id = body?.id;
  expect(id, 'Expected lead id in create response').toBeTruthy();
  return id as string;
}

async function deleteLeadIfExists(
  request: Parameters<typeof apiRequest>[0],
  token: string | null,
  leadId: string | null,
): Promise<void> {
  if (!token || !leadId) return;
  try {
    await apiRequest(request, 'DELETE', `/api/customers/leads/${leadId}`, { token });
  } catch {
    return;
  }
}

async function convertLead(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  leadId: string,
  payload: {
    createDeal: boolean;
    createPerson: boolean;
    createCompany: boolean;
    deal?: {
      title?: string;
      pipelineId?: string;
      pipelineStageId?: string;
      valueAmount?: number;
      valueCurrency?: string;
    };
  },
): Promise<{
  leadId: string;
  dealId?: string;
  personEntityId?: string;
  companyEntityId?: string;
}> {
  const response = await apiRequest(request, 'POST', `/api/customers/leads/${leadId}/convert`, {
    token,
    data: payload,
  });
  const body = await readJsonSafe<{
    id?: string;
    createdDealId?: string;
    createdPersonEntityId?: string;
    createdCompanyEntityId?: string;
    status?: string;
  }>(response);
  expect(response.ok(), `Failed to convert lead: ${response.status()}`).toBeTruthy();
  expect(body?.status, 'Expected status = qualified after conversion').toBe('qualified');
  return {
    leadId: body?.id ?? leadId,
    dealId: body?.createdDealId,
    personEntityId: body?.createdPersonEntityId,
    companyEntityId: body?.createdCompanyEntityId,
  };
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('TC-CRM-LEAD-001: Lead Creation, Qualification, and Conversion', () => {
  test('full lead lifecycle: create → qualify → verify downstream records', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    let leadId: string | null = null;
    let createdDealId: string | null = null;
    let createdPersonId: string | null = null;
    let createdCompanyId: string | null = null;

    const leadTitle = `QA Lead ${Date.now()}`;
    const contactFirstName = 'Alice';
    const contactLastName = `Test-${Date.now()}`;
    const contactEmail = `alice.test-${Date.now()}@example.com`;
    const companyName = `QA Lead Corp ${Date.now()}`;

    try {
      // ------------------------------------------------------------------
      // 1. Create a lead via API
      // ------------------------------------------------------------------
      token = await getAuthToken(request, 'admin');

      leadId = await createLeadFixture(request, token, {
        title: leadTitle,
        description: 'Integration test lead — should be cleaned up',
        source: 'integration-test',
        estimatedValueAmount: 5000,
        estimatedValueCurrency: 'PLN',
        companyName,
        contactFirstName,
        contactLastName,
        contactPhone: '+48 600 100 200',
        contactEmail,
      });

      expect(leadId, 'Lead ID must be a non-empty UUID').toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      // ------------------------------------------------------------------
      // 2. Verify lead appears in the list API
      // ------------------------------------------------------------------
      await expect
        .poll(
          async () => {
            const listResponse = await apiRequest(
              request,
              'GET',
              `/api/customers/leads?search=${encodeURIComponent(leadTitle)}&pageSize=20`,
              { token: token! },
            );
            if (!listResponse.ok()) return false;
            const payload = (await listResponse.json()) as {
              items?: Array<{ id?: string; title?: string }>;
            };
            return Array.isArray(payload.items)
              ? payload.items.some(
                  (item) => item.id === leadId || item.title === leadTitle,
                )
              : false;
          },
          { timeout: 30000 },
        )
        .toBe(true);

      // ------------------------------------------------------------------
      // 3. Open lead detail page in the browser
      // ------------------------------------------------------------------
      await login(page, 'admin');
      await page.goto(`/backend/customers/leads/${leadId}`);

      // Detail page should show the lead title
      await expect(page.getByText(leadTitle, { exact: true }).first()).toBeVisible({
        timeout: 10000,
      });

      // Candidate company/contact fields should be visible
      await expect(page.getByText(companyName, { exact: true }).first()).toBeVisible({
        timeout: 5000,
      });
      await expect(
        page.getByText(`${contactFirstName} ${contactLastName}`, { exact: true }).first(),
      ).toBeVisible({ timeout: 5000 });

      // ------------------------------------------------------------------
      // 4. Qualify the lead — create person, company, and deal
      // ------------------------------------------------------------------
      const conversionResult = await convertLead(request, token, leadId, {
        createDeal: true,
        createPerson: true,
        createCompany: true,
        deal: {
          valueAmount: 5000,
          valueCurrency: 'PLN',
        },
      });

      createdDealId = conversionResult.dealId ?? null;
      createdPersonId = conversionResult.personEntityId ?? null;
      createdCompanyId = conversionResult.companyEntityId ?? null;

      expect(createdDealId, 'Expected a deal to be created').toBeTruthy();
      expect(createdPersonId, 'Expected a person to be created').toBeTruthy();
      expect(createdCompanyId, 'Expected a company to be created').toBeTruthy();

      // ------------------------------------------------------------------
      // 5. Verify downstream records exist and are linked
      // ------------------------------------------------------------------

      // 5a. Person exists and has the lead's contact name
      const personResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/people/${createdPersonId}`,
        { token },
      );
      expect(personResponse.ok(), `Person detail should be accessible`).toBeTruthy();
      const person = (await personResponse.json()) as {
        firstName?: string;
        lastName?: string;
        companyEntityId?: string;
      };
      expect(person.firstName).toBe(contactFirstName);
      expect(person.lastName).toBe(contactLastName);
      // Person should be linked to the company created in the same conversion
      expect(person.companyEntityId).toBe(createdCompanyId);

      // 5b. Company exists and has the lead's company name
      const companyResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/companies/${createdCompanyId}`,
        { token },
      );
      expect(companyResponse.ok(), `Company detail should be accessible`).toBeTruthy();
      const company = (await companyResponse.json()) as { displayName?: string };
      expect(company.displayName).toBe(companyName);

      // 5c. Deal exists, has the lead title, and is linked to person + company
      const dealResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/deals/${createdDealId}`,
        { token },
      );
      expect(dealResponse.ok(), `Deal detail should be accessible`).toBeTruthy();
      const deal = (await dealResponse.json()) as {
        title?: string;
        personIds?: string[];
        companyIds?: string[];
      };
      expect(deal.title).toBe(leadTitle);
      expect(deal.personIds ?? []).toContain(createdPersonId);
      expect(deal.companyIds ?? []).toContain(createdCompanyId);

      // ------------------------------------------------------------------
      // 6. Verify lead shows conversion lineage
      // ------------------------------------------------------------------
      const leadDetailResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/leads/${leadId}`,
        { token },
      );
      expect(leadDetailResponse.ok()).toBeTruthy();
      const leadDetail = (await leadDetailResponse.json()) as {
        status?: string;
        createdDealId?: string;
        createdPersonEntityId?: string;
        createdCompanyEntityId?: string;
        convertedAt?: string;
        convertedByUserId?: string;
      };
      expect(leadDetail.status).toBe('qualified');
      expect(leadDetail.createdDealId).toBe(createdDealId);
      expect(leadDetail.createdPersonEntityId).toBe(createdPersonId);
      expect(leadDetail.createdCompanyEntityId).toBe(createdCompanyId);
      expect(leadDetail.convertedAt, 'convertedAt must be set').toBeTruthy();
      expect(leadDetail.convertedByUserId, 'convertedByUserId must be set').toBeTruthy();

      // ------------------------------------------------------------------
      // 7. Verify converted lead cannot be converted again
      // ------------------------------------------------------------------
      const duplicateConvertResponse = await apiRequest(
        request,
        'POST',
        `/api/customers/leads/${leadId}/convert`,
        {
          token,
          data: { createDeal: true, createPerson: false, createCompany: false },
        },
      );
      expect(duplicateConvertResponse.ok(), 'Duplicate conversion must be rejected').toBeFalsy();
      expect(duplicateConvertResponse.status()).toBe(409); // or 400 — spec says "reject"

      // ------------------------------------------------------------------
      // 8. Verify lead appears in the list with qualified status
      // ------------------------------------------------------------------
      await expect
        .poll(
          async () => {
            const listResponse = await apiRequest(
              request,
              'GET',
              `/api/customers/leads?status=qualified&pageSize=20`,
              { token: token! },
            );
            if (!listResponse.ok()) return false;
            const payload = (await listResponse.json()) as {
              items?: Array<{ id?: string; status?: string }>;
            };
            return Array.isArray(payload.items)
              ? payload.items.some(
                  (item) => item.id === leadId && item.status === 'qualified',
                )
              : false;
          },
          { timeout: 30000 },
        )
        .toBe(true);
    } finally {
      // Clean up in reverse dependency order
      await deleteEntityIfExists(request, token, '/api/customers/deals', createdDealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', createdPersonId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', createdCompanyId);
      await deleteLeadIfExists(request, token, leadId);
    }
  });

  test('should reject qualification when all checkboxes are false', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    let leadId: string | null = null;

    try {
      leadId = await createLeadFixture(request, token, {
        title: `QA Lead Empty Convert ${Date.now()}`,
        companyName: 'Some Corp',
        contactFirstName: 'Bob',
        contactLastName: 'Empty',
      });

      const response = await apiRequest(
        request,
        'POST',
        `/api/customers/leads/${leadId}/convert`,
        {
          token,
          data: { createDeal: false, createPerson: false, createCompany: false },
        },
      );
      expect(response.ok(), 'All-false conversion must be rejected').toBeFalsy();
    } finally {
      await deleteLeadIfExists(request, token, leadId);
    }
  });

  test('should reject person creation when contact name fields are missing', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    let leadId: string | null = null;

    try {
      leadId = await createLeadFixture(request, token, {
        title: `QA Lead No Contact ${Date.now()}`,
        // No contactFirstName or contactLastName
      });

      const response = await apiRequest(
        request,
        'POST',
        `/api/customers/leads/${leadId}/convert`,
        {
          token,
          data: { createDeal: false, createPerson: true, createCompany: false },
        },
      );
      expect(response.ok(), 'Person creation without contact name must be rejected').toBeFalsy();
    } finally {
      await deleteLeadIfExists(request, token, leadId);
    }
  });

  test('should reject company creation when company name is missing', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    let leadId: string | null = null;

    try {
      leadId = await createLeadFixture(request, token, {
        title: `QA Lead No Company ${Date.now()}`,
        // No companyName
      });

      const response = await apiRequest(
        request,
        'POST',
        `/api/customers/leads/${leadId}/convert`,
        {
          token,
          data: { createDeal: false, createPerson: false, createCompany: true },
        },
      );
      expect(response.ok(), 'Company creation without company name must be rejected').toBeFalsy();
    } finally {
      await deleteLeadIfExists(request, token, leadId);
    }
  });

  test('should support person-only conversion', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    let leadId: string | null = null;
    let createdPersonId: string | null = null;

    try {
      leadId = await createLeadFixture(request, token, {
        title: `QA Lead Person Only ${Date.now()}`,
        contactFirstName: 'Carol',
        contactLastName: `Solo-${Date.now()}`,
      });

      const result = await convertLead(request, token, leadId, {
        createDeal: false,
        createPerson: true,
        createCompany: false,
      });

      createdPersonId = result.personEntityId ?? null;
      expect(createdPersonId, 'Expected a person to be created').toBeTruthy();
      expect(result.dealId, 'Deal should NOT be created').toBeFalsy();
      expect(result.companyEntityId, 'Company should NOT be created').toBeFalsy();

      // Verify lead lineage
      const leadDetailResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/leads/${leadId}`,
        { token },
      );
      const leadDetail = (await leadDetailResponse.json()) as {
        status?: string;
        createdPersonEntityId?: string;
      };
      expect(leadDetail.status).toBe('qualified');
      expect(leadDetail.createdPersonEntityId).toBe(createdPersonId);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', createdPersonId);
      await deleteLeadIfExists(request, token, leadId);
    }
  });
});
