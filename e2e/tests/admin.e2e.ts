import { test, expect, unique } from './support/fixtures';

/**
 * Administration.
 * Ported from .ai/qa/scenarios/TC-ADMIN-001 and TC-ADMIN-004.
 */
test.describe('admin', { tags: ['admin'], session: 'admin' }, () => {
  test('TC-ADMIN-001 creates an API key that is shown once', async ({ app, agent, api, stamp }) => {
    const keyName = `${stamp} Key`;
    await app.open('/backend/api-keys');

    // A key saved without an organization is tenant-wide and never shows up in the
    // organization-scoped list, so the goal names the organization explicitly.
    await agent.act('Create a new API key named {name} for the organization {organization}; leave the other fields at their defaults. Stop as soon as the dialog showing the generated key appears, and leave that dialog open.', {
      params: { name: unique(keyName), organization: 'Acme Corp' },
    });
    await agent.assert('a dialog shows the newly generated key exactly once, warns to keep it safe, and mentions a key prefix starting with omk_');

    await agent.act('Close the key dialog');
    // The keys list is served from a cache until the page is reloaded (the Playwright
    // original re-navigates too), so open the list fresh before searching it.
    await app.open('/backend/api-keys');
    await agent.act('Search the API keys list for {name}', { params: { name: unique(keyName) } });
    await agent.assert(`the API keys list contains an entry named "${keyName}"`);

    const keys = await api.list<{ id: string; name: string }>(`/api/api_keys/keys?search=${encodeURIComponent(keyName)}`);
    const created = keys.find((key) => key.name === keyName);
    expect(created).toBeTruthy();
    api.track('/api/api_keys/keys', created?.id);
  });

  test('TC-ADMIN-004 creates a dictionary and adds an entry', async ({ app, agent, api, stamp }) => {
    const key = stamp.toLowerCase().replace(/\W+/g, '_');
    const name = `${stamp} Dictionary`;
    await app.open('/backend/config/dictionaries');

    await agent.act('Create a new dictionary with the key {key} and the display name {name}', { params: { key: unique(key), name: unique(name) } });
    // The dictionary's row is named by display name and key together, so both are run-unique here.
    await agent.act('Select the dictionary {name} (key {key}) in the list, then add an entry to it with value {value} and label {label}', {
      params: { name: unique(name), key: unique(key), value: 'gold', label: 'Gold tier' },
    });
    await agent.assert(`the dictionary "${name}" is selected and its entries table lists "Gold tier"`);

    const dictionaries = await api.list<{ id: string; key: string }>('/api/dictionaries');
    const created = dictionaries.find((dictionary) => dictionary.key === key);
    expect(created).toBeTruthy();
    if (created) {
      // Dictionaries delete by path segment rather than by query id.
      await api.request('DELETE', `/api/dictionaries/${encodeURIComponent(created.id)}`).catch(() => {});
    }
  });
});
