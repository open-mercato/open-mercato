import { test, expect } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures';

/**
 * TC-INBOX-008: Permission gates — non-admin users lack inbox_ops.proposals.manage
 * Source: GitHub issue #2479 (inbox_ops integration coverage)
 *
 * RBAC is enforced declaratively (route `requireFeatures`) before any resource
 * lookup, so mutation endpoints return 403 for a view-only principal regardless
 * of whether the target ids exist — this spec needs no LLM extraction and always
 * runs. A dedicated `inbox_ops.proposals.view`-only role is created because the
 * seeded `employee` role already holds `proposals.manage` and would not be denied.
 */
test.describe('TC-INBOX-008: Permission gates', () => {
  // Well-formed but non-existent ids: the feature gate fires before the lookup,
  // so these never need to resolve to real records for the 403 assertions.
  const FAKE_ID = '00000000-0000-4000-8000-000000000000';
  const stamp = Date.now();
  const viewerEmail = `inbox-viewer-${stamp}@example.com`;
  const viewerPassword = 'Viewer123!';

  let adminToken: string;
  let viewerToken: string;
  let roleId: string | null = null;
  let userId: string | null = null;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(60000);
    adminToken = await getAuthToken(request, 'admin');
    const { organizationId } = getTokenContext(adminToken);

    roleId = await createRoleFixture(request, adminToken, { name: `inbox-viewer-${stamp}` });
    await setRoleAclFeatures(request, adminToken, {
      roleId,
      features: ['inbox_ops.proposals.view'],
    });
    userId = await createUserFixture(request, adminToken, {
      email: viewerEmail,
      password: viewerPassword,
      organizationId,
      roles: [roleId],
      name: 'Inbox Viewer (TC-INBOX-008)',
    });
    viewerToken = await getAuthToken(request, viewerEmail, viewerPassword);
  });

  test.afterAll(async ({ request }) => {
    await deleteUserIfExists(request, adminToken, userId);
    await deleteRoleIfExists(request, adminToken, roleId);
  });

  test('view-only user can read proposals and counts', async ({ request }) => {
    const list = await apiRequest(request, 'GET', '/api/inbox_ops/proposals?pageSize=5', { token: viewerToken });
    expect(list.status()).toBe(200);

    const counts = await apiRequest(request, 'GET', '/api/inbox_ops/proposals/counts', { token: viewerToken });
    expect(counts.status()).toBe(200);
  });

  test('view-only user is denied every proposals.manage mutation with 403', async ({ request }) => {
    const accept = await apiRequest(
      request,
      'POST',
      `/api/inbox_ops/proposals/${FAKE_ID}/actions/${FAKE_ID}/accept`,
      { token: viewerToken },
    );
    expect(accept.status()).toBe(403);

    const reject = await apiRequest(
      request,
      'POST',
      `/api/inbox_ops/proposals/${FAKE_ID}/reject`,
      { token: viewerToken },
    );
    expect(reject.status()).toBe(403);

    const edit = await apiRequest(
      request,
      'PATCH',
      `/api/inbox_ops/proposals/${FAKE_ID}/actions/${FAKE_ID}`,
      { token: viewerToken, data: { payload: {} } },
    );
    expect(edit.status()).toBe(403);

    const translate = await apiRequest(
      request,
      'POST',
      `/api/inbox_ops/proposals/${FAKE_ID}/translate`,
      { token: viewerToken, data: { targetLocale: 'de' } },
    );
    expect(translate.status()).toBe(403);

    const reprocess = await apiRequest(
      request,
      'POST',
      `/api/inbox_ops/emails/${FAKE_ID}/reprocess`,
      { token: viewerToken },
    );
    expect(reprocess.status()).toBe(403);
  });

  test('view-only user is denied settings access (settings.manage)', async ({ request }) => {
    const read = await apiRequest(request, 'GET', '/api/inbox_ops/settings', { token: viewerToken });
    expect(read.status()).toBe(403);

    const write = await apiRequest(request, 'PATCH', '/api/inbox_ops/settings', {
      token: viewerToken,
      data: { workingLanguage: 'en' },
    });
    expect(write.status()).toBe(403);
  });

  test('an authorized admin passes the feature gate (404, not 403) on the same mutation', async ({ request }) => {
    // Admin holds proposals.manage, so the gate lets the request reach the handler,
    // which then reports the fabricated action as not found. This proves the 403s
    // above are feature-driven, not a blanket block.
    const accept = await apiRequest(
      request,
      'POST',
      `/api/inbox_ops/proposals/${FAKE_ID}/actions/${FAKE_ID}/accept`,
      { token: adminToken },
    );
    expect(accept.status()).toBe(404);
    const body = await readJsonSafe<{ error?: string }>(accept);
    expect(body?.error ?? '').toMatch(/not found/i);
  });
});
