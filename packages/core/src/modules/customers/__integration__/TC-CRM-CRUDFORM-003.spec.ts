import { test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createCompanyFixture,
  createPersonFixture,
  createPipelineFixture,
  createPipelineStageFixture,
} from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createPersistenceFixtures, readDetail } from './helpers/crudFormPersistence';

const DEALS_PATH = '/api/customers/deals';
const COMPANIES_PATH = '/api/customers/companies';
const PEOPLE_PATH = '/api/customers/people';
const PIPELINES_PATH = '/api/customers/pipelines';
const STAGES_PATH = '/api/customers/pipeline-stages';
const DEAL_ENTITY_ID = 'customers:customer_deal';

type DealDetail = {
  deal?: CrudRecord;
  linkedPersonIds?: string[];
  linkedCompanyIds?: string[];
  customFields?: CrudRecord;
};

function futureDate(days: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

test.describe('TC-CRM-CRUDFORM-003: Deal field persistence', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips deal, pipeline, linked record and custom field values', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const fixtures = createPersistenceFixtures(request, token);
    const name = `QA Deal ${fixtures.suffix}`;

    try {
      const company = fixtures.trackRecord(COMPANIES_PATH, await createCompanyFixture(request, token, `${name} buyer`));
      const secondCompany = fixtures.trackRecord(COMPANIES_PATH, await createCompanyFixture(request, token, `${name} partner`));
      const person = fixtures.trackRecord(PEOPLE_PATH, await createPersonFixture(request, token, {
        firstName: 'Grace',
        lastName: 'Hopper',
        displayName: `${name} buyer contact`,
      }));
      const secondPerson = fixtures.trackRecord(PEOPLE_PATH, await createPersonFixture(request, token, {
        firstName: 'Katherine',
        lastName: 'Johnson',
        displayName: `${name} partner contact`,
      }));
      const pipelineId = fixtures.trackRecord(
        PIPELINES_PATH,
        await createPipelineFixture(request, token, { name }),
        true,
      );
      const nextPipelineId = fixtures.trackRecord(
        PIPELINES_PATH,
        await createPipelineFixture(request, token, { name: `${name} next pipeline` }),
        true,
      );
      const firstStageLabel = await fixtures.dictionaryValue('pipeline-stages', 'qualification');
      const secondStageLabel = await fixtures.dictionaryValue('pipeline-stages', 'proposal');
      const firstStage = fixtures.trackRecord(
        STAGES_PATH,
        await createPipelineStageFixture(request, token, { pipelineId, label: firstStageLabel, order: 0 }),
        true,
      );
      const secondStage = fixtures.trackRecord(
        STAGES_PATH,
        await createPipelineStageFixture(request, token, { pipelineId: nextPipelineId, label: secondStageLabel, order: 0 }),
        true,
      );
      const seats = await fixtures.customField(DEAL_ENTITY_ID, 'seats', 'integer');
      const options = await fixtures.customField(DEAL_ENTITY_ID, 'options', 'select', {
        options: ['alpha', 'beta', 'gamma'],
        multi: true,
      });
      const initial = {
        title: name,
        description: 'Original deal description',
        status: await fixtures.dictionaryValue('deal-statuses', 'qualified'),
        source: await fixtures.dictionaryValue('sources', 'outbound'),
        ownerUserId: getTokenScope(token).userId,
        pipelineId,
        pipelineStageId: firstStage,
        valueAmount: 50000,
        valueCurrency: 'USD',
        probability: 40,
        expectedCloseAt: futureDate(90),
        personIds: [person, secondPerson].sort(),
        companyIds: [company],
      };
      const changes = {
        title: `${name} updated`,
        status: await fixtures.dictionaryValue('deal-statuses', 'negotiating'),
        source: await fixtures.dictionaryValue('sources', 'event'),
        ownerUserId: null,
        pipelineId: nextPipelineId,
        pipelineStageId: secondStage,
        valueAmount: 75000,
        valueCurrency: 'EUR',
        probability: 75,
        expectedCloseAt: futureDate(120),
        personIds: [secondPerson],
        companyIds: [secondCompany],
      };

      await fixtures.roundTrip({
        collectionPath: DEALS_PATH,
        readById: async (id) => {
          const detail = await readDetail<DealDetail>(request, token, DEALS_PATH, id);
          const deal = detail?.deal;
          if (!detail || deal?.id !== id) return null;
          const selectedOptions = detail.customFields?.[options];
          return {
            ...deal,
            valueAmount: typeof deal.valueAmount === 'string' ? Number(deal.valueAmount) : deal.valueAmount,
            probability: typeof deal.probability === 'string' ? Number(deal.probability) : deal.probability,
            personIds: detail.linkedPersonIds?.sort(),
            companyIds: detail.linkedCompanyIds?.sort(),
            customValues: {
              ...detail.customFields,
              [options]: Array.isArray(selectedOptions) ? [...selectedOptions].sort() : selectedOptions,
            },
          };
        },
        create: { payload: { ...initial, [`cf_${seats}`]: 25, [`cf_${options}`]: ['alpha', 'beta'] } },
        update: { payload: (id) => ({ id, ...changes, [`cf_${seats}`]: 60, [`cf_${options}`]: ['gamma'] }) },
        expectAfterCreate: {
          scalars: initial,
          customFields: { [seats]: 25, [options]: ['alpha', 'beta'] },
        },
        expectAfterUpdate: {
          scalars: { ...initial, ...changes },
          customFields: { [seats]: 60, [options]: ['gamma'] },
        },
      });
    } finally {
      await fixtures.cleanup();
    }
  });
});
