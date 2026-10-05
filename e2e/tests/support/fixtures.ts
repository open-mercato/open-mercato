import { test as base } from '@e2edev/playwright';
import { OmApi, type Persona } from './api';

export interface SuiteFixtures {
  /** Admin API client; anything it creates or tracks is deleted after the test. */
  api: OmApi;
  /** API client for another demo persona, sharing the admin client's teardown. */
  apiAs: (persona: Persona) => OmApi;
  /** A run-unique stamp for names, so parallel runs never collide and cleanup is exact. Values built from it go into `act` params as `unique(...)`. */
  stamp: string;
}

export const test = base.extend<SuiteFixtures>({
  api: async ({ app }, use) => {
    const api = OmApi.persona(requireBaseUrl(app.baseUrl), 'admin');
    await use(api);
    await api.cleanup();
  },
  apiAs: async ({ app }, use) => {
    const clients: OmApi[] = [];
    await use((persona) => {
      const client = OmApi.persona(requireBaseUrl(app.baseUrl), persona);
      clients.push(client);
      return client;
    });
    for (const client of clients) await client.cleanup();
  },
  stamp: async ({}, use) => {
    await use(`E2E ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  },
});

function requireBaseUrl(url: string | undefined): string {
  if (!url) throw new Error('The web target must declare a url');
  return url.replace(/\/$/, '');
}

/** Cookies that acknowledge the demo, cookie, and feedback notices, so a signed-in session starts clean. */
export function noticeAckCookies(baseUrl: string) {
  return [
    { url: baseUrl, name: 'om_demo_notice_ack', value: 'ack', sameSite: 'Lax' as const },
    { url: baseUrl, name: 'om_cookie_notice_ack', value: 'ack', sameSite: 'Lax' as const },
    { url: baseUrl, name: 'om_feedback_suppress', value: '1', sameSite: 'Lax' as const },
    { url: baseUrl, name: 'om_feedback_shown', value: new Date().toISOString().slice(0, 10), sameSite: 'Lax' as const },
  ];
}

export { expect, credentials, secrets, unique } from 'e2e';
