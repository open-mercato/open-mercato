import { test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures';
import { skipIfCrudFormExtensionTestsDisabled } from '@open-mercato/core/helpers/integration/crudFormPersistence';
import { createPersistenceFixtures, readContact } from './helpers/crudFormPersistence';

const PEOPLE_PATH = '/api/customers/people';
const COMPANIES_PATH = '/api/customers/companies';
const PERSON_ENTITY_ID = 'customers:customer_person_profile';

test.describe('TC-CRM-CRUDFORM-001: Person field persistence', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips contact, profile, company, dictionary, tag and custom field values', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const fixtures = createPersistenceFixtures(request, token);
    const name = `QA Person ${fixtures.suffix}`;

    try {
      const companyId = fixtures.trackRecord(
        COMPANIES_PATH,
        await createCompanyFixture(request, token, `${name} employer`),
      );
      const nextCompanyId = fixtures.trackRecord(
        COMPANIES_PATH,
        await createCompanyFixture(request, token, `${name} next employer`),
      );
      const firstTag = await fixtures.tag('person-first');
      const secondTag = await fixtures.tag('person-second');
      const pronouns = await fixtures.customField(PERSON_ENTITY_ID, 'pronouns', 'text');
      const buyingRole = await fixtures.customField(PERSON_ENTITY_ID, 'buying_role', 'select', {
        options: ['champion', 'evaluator'],
      });
      const initial = {
        firstName: 'Ada',
        lastName: 'Lovelace',
        displayName: name,
        description: 'Original person description',
        primaryEmail: `person-${fixtures.suffix}@example.test`,
        primaryPhone: '+14155552671',
        jobTitle: await fixtures.dictionaryValue('job-titles', 'analyst'),
        department: 'Engineering',
        seniority: 'senior',
        timezone: 'America/New_York',
        preferredName: 'Ada',
        linkedInUrl: 'https://www.linkedin.com/in/crm-test-person',
        twitterUrl: 'https://twitter.com/crm_test_person',
        companyEntityId: companyId,
        status: await fixtures.dictionaryValue('statuses', 'active'),
        lifecycleStage: await fixtures.dictionaryValue('lifecycle-stages', 'lead'),
        source: await fixtures.dictionaryValue('sources', 'referral'),
        tags: [firstTag],
      };
      const changes = {
        firstName: 'Augusta',
        lastName: 'Byron',
        displayName: `${name} updated`,
        description: 'Updated person description',
        primaryEmail: `updated-person-${fixtures.suffix}@example.test`,
        primaryPhone: '+14155552672',
        jobTitle: await fixtures.dictionaryValue('job-titles', 'director'),
        seniority: 'executive',
        preferredName: 'Augusta',
        linkedInUrl: 'https://www.linkedin.com/in/crm-updated-person',
        twitterUrl: 'https://twitter.com/crm_updated_person',
        companyEntityId: nextCompanyId,
        status: await fixtures.dictionaryValue('statuses', 'qualified'),
        lifecycleStage: await fixtures.dictionaryValue('lifecycle-stages', 'customer'),
        source: await fixtures.dictionaryValue('sources', 'event'),
        tags: [firstTag, secondTag].sort(),
      };

      await fixtures.roundTrip({
        collectionPath: PEOPLE_PATH,
        readById: (id) => readContact(request, token, PEOPLE_PATH, id, 'person'),
        create: { payload: { ...initial, [`cf_${pronouns}`]: 'she/her', [`cf_${buyingRole}`]: 'champion' } },
        update: { payload: (id) => ({ id, ...changes, [`cf_${pronouns}`]: 'they/them', [`cf_${buyingRole}`]: 'evaluator' }) },
        expectAfterCreate: {
          scalars: initial,
          customFields: { [pronouns]: 'she/her', [buyingRole]: 'champion' },
        },
        expectAfterUpdate: {
          scalars: { ...initial, ...changes },
          customFields: { [pronouns]: 'they/them', [buyingRole]: 'evaluator' },
        },
      });
    } finally {
      await fixtures.cleanup();
    }
  });
});
