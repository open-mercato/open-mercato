import { test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { skipIfCrudFormExtensionTestsDisabled } from '@open-mercato/core/helpers/integration/crudFormPersistence';
import { createPersistenceFixtures, readContact } from './helpers/crudFormPersistence';

const COMPANIES_PATH = '/api/customers/companies';
const COMPANY_ENTITY_ID = 'customers:customer_company_profile';

test.describe('TC-CRM-CRUDFORM-002: Company field persistence', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips contact, company profile, dictionary, tag and custom field values', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const fixtures = createPersistenceFixtures(request, token);
    const name = `QA Company ${fixtures.suffix}`;

    try {
      const firstTag = await fixtures.tag('company-first');
      const secondTag = await fixtures.tag('company-second');
      const notes = await fixtures.customField(COMPANY_ENTITY_ID, 'notes', 'multiline');
      const caseStudy = await fixtures.customField(COMPANY_ENTITY_ID, 'case_study', 'boolean');
      const initial = {
        displayName: name,
        description: 'Original company description',
        legalName: `${name} Ltd`,
        brandName: 'Original Brand',
        primaryEmail: `company-${fixtures.suffix}@example.test`,
        primaryPhone: '+14155552671',
        domain: 'crm-company.example',
        websiteUrl: 'https://crm-company.example',
        industry: await fixtures.dictionaryValue('industries', 'software'),
        sizeBucket: '51-200',
        annualRevenue: 1250000.50,
        taxId: 'QA123456789',
        status: await fixtures.dictionaryValue('statuses', 'active'),
        lifecycleStage: await fixtures.dictionaryValue('lifecycle-stages', 'lead'),
        source: await fixtures.dictionaryValue('sources', 'referral'),
        tags: [firstTag, secondTag].sort(),
      };
      const changes = {
        displayName: `${name} updated`,
        description: 'Updated company description',
        brandName: 'Updated Brand',
        primaryEmail: `updated-company-${fixtures.suffix}@example.test`,
        primaryPhone: '+14155552672',
        domain: 'crm-updated-company.example',
        websiteUrl: 'https://crm-updated-company.example',
        industry: await fixtures.dictionaryValue('industries', 'manufacturing'),
        sizeBucket: '201-500',
        annualRevenue: 2750000.25,
        taxId: 'QA987654321',
        status: await fixtures.dictionaryValue('statuses', 'qualified'),
        lifecycleStage: await fixtures.dictionaryValue('lifecycle-stages', 'customer'),
        source: await fixtures.dictionaryValue('sources', 'event'),
        tags: [secondTag],
      };
      const companyNotes = 'First discussion\nFollow-up scheduled';
      const updatedNotes = 'Follow-up completed\nContract sent';

      await fixtures.roundTrip({
        collectionPath: COMPANIES_PATH,
        readById: async (id) => {
          const company = await readContact(request, token, COMPANIES_PATH, id, 'company');
          if (!company) return null;
          return {
            ...company,
            annualRevenue: typeof company.annualRevenue === 'string' ? Number(company.annualRevenue) : company.annualRevenue,
          };
        },
        create: { payload: { ...initial, [`cf_${notes}`]: companyNotes, [`cf_${caseStudy}`]: true } },
        update: { payload: (id) => ({ id, ...changes, [`cf_${notes}`]: updatedNotes, [`cf_${caseStudy}`]: false }) },
        expectAfterCreate: {
          scalars: initial,
          customFields: { [notes]: companyNotes, [caseStudy]: true },
        },
        expectAfterUpdate: {
          scalars: { ...initial, ...changes },
          customFields: { [notes]: updatedNotes, [caseStudy]: false },
        },
      });
    } finally {
      await fixtures.cleanup();
    }
  });
});
