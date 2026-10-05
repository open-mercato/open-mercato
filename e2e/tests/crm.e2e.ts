import { z } from 'zod';
import { test, expect, unique } from './support/fixtures';
import { idFromUrl } from './support/api';

const COMPANIES = '/api/customers/companies';
const PEOPLE = '/api/customers/people';

/**
 * Customers / CRM.
 * Ported from .ai/qa/scenarios/TC-CRM-001, 003, 004, 014, 015.
 */
test.describe('crm', { tags: ['crm'], session: 'admin' }, () => {
  test('TC-CRM-001 creates a company and finds it in the list', async ({ app, agent, api, stamp, web, screen }) => {
    const name = `${stamp} Company`;
    await app.open('/backend/customers/companies');

    await agent.act('Create a new company named {name} with the website {website}. Submit the form.', {
      params: { name: unique(name), website: 'https://example.com' },
    });

    await expect(web).toHaveURL(/\/backend\/customers\/companies-v2\/[0-9a-f-]{36}$/i, { timeout: 60_000 });
    const companyId = idFromUrl(await web.url());
    api.track(COMPANIES, companyId);
    await agent.assert(`the company detail page for "${name}" is showing`);

    await app.open('/backend/customers/companies');
    await agent.act('Search the companies list for {name}', { params: { name: unique(name) } });
    await expect(screen.getByText(/Showing 1 to 1 of 1/)).toBeVisible({ timeout: 30_000 });
    await agent.assert(`the list shows exactly one company, "${name}"`);

    const items = await api.list<{ id: string }>(`${COMPANIES}?search=${encodeURIComponent(name)}&pageSize=20`);
    expect(items.some((item) => item.id === companyId)).toBe(true);
  });

  test('TC-CRM-004 creates a person linked to an existing company', async ({ app, agent, api, stamp, web }) => {
    const companyName = `${stamp} Employer`;
    await api.create(COMPANIES, { displayName: companyName });
    const firstName = stamp.replace(/\s+/g, '');
    const email = `${firstName.toLowerCase()}@example.com`;
    await app.open('/backend/customers/people');

    await agent.act(
      'Create a new person with first name {firstName}, last name {lastName}, email {email}, phone {phone}, linked to the company {company}. Submit the form.',
      { params: { firstName: unique(firstName), lastName: 'Tester', email: unique(email), phone: '+1 555 010 0042', company: unique(companyName) } },
    );

    await expect(web).toHaveURL(/\/backend\/customers\/people-v2\/[0-9a-f-]{36}$/i, { timeout: 60_000 });
    const personId = idFromUrl(await web.url());
    api.track(PEOPLE, personId);

    const details = await agent.extract('the full name of this person and the company they belong to', {
      schema: z.object({ fullName: z.string(), company: z.string().nullable() }),
    });
    expect(details.fullName).toContain(firstName);
    expect(details.company ?? '').toContain(companyName);

    const people = await api.list<{ id: string; display_name: string }>(`${PEOPLE}?search=${encodeURIComponent(firstName)}&pageSize=20`);
    expect(people.find((person) => person.id === personId)?.display_name).toBe(`${firstName} Tester`);
  });

  test('TC-CRM-003 edits a company name and website', async ({ app, agent, api, stamp }) => {
    const original = `${stamp} Original`;
    const renamed = `${stamp} Renamed`;
    const companyId = await api.create(COMPANIES, { displayName: original });
    await app.open(`/backend/customers/companies-v2/${companyId}`);

    await agent.act('Rename this company to {name} and set its website to {website}. Save the change.', {
      params: { name: unique(renamed), website: 'https://renamed.example.com' },
    });
    await agent.assert(`the company is now called "${renamed}"`);

    await expect
      .poll(async () => {
        const items = await api.list<{ id: string; display_name: string }>(`${COMPANIES}?search=${encodeURIComponent(renamed)}&pageSize=20`);
        return items.find((item) => item.id === companyId)?.display_name ?? null;
      }, { timeout: 30_000 })
      .toBe(renamed);
  });

  test('TC-CRM-015 searching the companies list narrows it to the match', async ({ app, agent, api, stamp, screen }) => {
    const needle = `${stamp} Needle`;
    const hay = `${stamp} Haystack`;
    await api.create(COMPANIES, { displayName: needle });
    await api.create(COMPANIES, { displayName: hay });
    await app.open('/backend/customers/companies');

    await agent.act('Search the companies list for {term}', { params: { term: unique(needle) } });
    await expect(screen.getByText(/Showing 1 to 1 of 1/)).toBeVisible({ timeout: 30_000 });
    await agent.assert(`the list contains "${needle}" and does not contain "${hay}"`);

    await agent.act('Clear the search box');
    await agent.assert('the list shows more than one company again');
  });

  test('TC-CRM-014 deletes a company from its detail page', async ({ app, agent, api, stamp }) => {
    const name = `${stamp} Doomed`;
    const companyId = await api.create(COMPANIES, { displayName: name });
    await app.open(`/backend/customers/companies-v2/${companyId}`);

    await agent.act('Delete this company and confirm the deletion when asked');
    await agent.assert(`the company "${name}" is no longer shown; either the companies list is showing without it, or a message says it was deleted`);

    await expect
      .poll(async () => {
        const items = await api.list<{ id: string }>(`${COMPANIES}?search=${encodeURIComponent(name)}&pageSize=20`);
        return items.some((item) => item.id === companyId);
      }, { timeout: 30_000 })
      .toBe(false);
  });
});
