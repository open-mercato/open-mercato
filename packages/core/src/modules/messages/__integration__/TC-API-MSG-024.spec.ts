import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { z } from 'zod';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { createUserFixture } from '@open-mercato/core/helpers/integration/authFixtures';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createOrganizationInDb,
  setUserAclInDb,
  withClient,
} from '@open-mercato/core/helpers/integration/dbFixtures';

const listSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    subject: z.string(),
    status: z.string(),
    readAt: z.string().transform((value) => new Date(value).toISOString()).nullable(),
  })),
  total: z.number(),
});

const listUrl = '/api/messages?folder=inbox&page=1&pageSize=100';

async function listMessages(request: APIRequestContext, token: string) {
  const response = await apiRequest(request, 'GET', listUrl, { token });
  expect(response.status()).toBe(200);
  return listSchema.parse(await response.json());
}

test.describe('TC-API-MSG-024: User-scoped message list cache regression (#4835)', () => {
  test('serves cache hits without leaking messages or recipient state and invalidates on mark-read', async ({ request }) => {
    expect(process.env.ENABLE_CRUD_API_CACHE, 'Run through the cache-enabled managed integration runner').toBe('true');
    const adminToken = await getAuthToken(request, 'superadmin');
    const { tenantId } = getTokenScope(adminToken);
    const stamp = randomUUID();
    const password = `Msg1!${randomUUID()}`;
    const userIds: string[] = [];
    const messageIds = [randomUUID(), randomUUID(), randomUUID()];
    const [onlyAId, onlyBId, sharedId] = messageIds;
    let organizationId: string | null = null;

    try {
      organizationId = await createOrganizationInDb({ name: `TC-API-MSG-024 ${stamp}`, tenantId });
      const tokens: string[] = [];
      for (const suffix of ['a', 'b']) {
        const email = `msg-cache-${suffix}-${stamp}@example.com`;
        const userId = await createUserFixture(request, adminToken, {
          email, password, organizationId, roles: [],
        });
        userIds.push(userId);
        await setUserAclInDb({
          userId, tenantId, organizations: [organizationId], features: ['messages.view'],
        });
        const token = await getAuthToken(request, email, password);
        expect(getTokenScope(token)).toMatchObject({ tenantId, organizationId, userId });
        tokens.push(token);
      }
      const [userAId, userBId] = userIds;
      const [tokenA, tokenB] = tokens;
      const sharedReadAt = new Date().toISOString();

      await withClient(async (client) => {
        for (const messageId of messageIds) {
          await client.query(
            `insert into messages
               (id, sender_user_id, subject, body, status, is_draft, sent_at, tenant_id, organization_id, created_at, updated_at)
             values ($1, $2, $3, $4, 'sent', false, now(), $5, $6, now(), now())`,
            [messageId, userAId, `TC-API-MSG-024 ${messageId}`, 'Cache isolation fixture', tenantId, organizationId],
          );
        }
        for (const [messageId, userId, status, readAt] of [
          [onlyAId, userAId, 'unread', null],
          [onlyBId, userBId, 'unread', null],
          [sharedId, userAId, 'unread', null],
          [sharedId, userBId, 'read', sharedReadAt],
        ]) {
          await client.query(
            `insert into message_recipients (id, message_id, recipient_user_id, status, read_at, created_at)
             values (gen_random_uuid(), $1, $2, $3, $4, now())`,
            [messageId, userId, status, readAt],
          );
        }
      });

      const warmedAt = Date.now();
      const coldA = await listMessages(request, tokenA);
      expect(coldA.total).toBe(2);
      expect(coldA.items.map((item) => item.id).sort()).toEqual([onlyAId, sharedId].sort());
      expect(coldA.items.every((item) => item.status === 'unread' && item.readAt === null)).toBe(true);

      await test.step('prove a real cache hit using an out-of-band fixture update', async () => {
        await withClient(async (client) => {
          const changed = await client.query<{ status: string }>(
            `update message_recipients set status = 'read', read_at = now()
             where message_id = $1 and recipient_user_id = $2 returning status`,
            [onlyAId, userAId],
          );
          expect(changed.rows).toEqual([{ status: 'read' }]);
        });
        expect(await listMessages(request, tokenA), 'The identical request must serve cached unread state despite the changed DB row').toEqual(coldA);
        await withClient(async (client) => {
          await client.query(
            `update message_recipients set status = 'unread', read_at = null
             where message_id = $1 and recipient_user_id = $2`,
            [onlyAId, userAId],
          );
        });
      });

      await test.step('isolate both private records and shared-message recipient state on the same URL', async () => {
        const coldB = await listMessages(request, tokenB);
        expect(coldB.total).toBe(2);
        expect(coldB.items.map((item) => item.id).sort()).toEqual([onlyBId, sharedId].sort());
        expect(coldB.items.find((item) => item.id === sharedId)).toMatchObject({ status: 'read', readAt: sharedReadAt });
        expect(coldB.items.find((item) => item.id === onlyBId)).toMatchObject({ status: 'unread', readAt: null });
        expect(await listMessages(request, tokenB)).toEqual(coldB);
        expect(await listMessages(request, tokenA)).toEqual(coldA);
      });

      await test.step('invalidate the warm list immediately through the real mark-read API', async () => {
        const response = await apiRequest(request, 'PUT', `/api/messages/${onlyAId}/read`, { token: tokenA });
        expect(response.status()).toBe(200);
        const updatedA = await listMessages(request, tokenA);
        expect(Date.now() - warmedAt, 'The original 30-second cache TTL must not have expired').toBeLessThan(30_000);
        expect(updatedA.total).toBe(2);
        expect(updatedA.items.map((item) => item.id).sort()).toEqual([onlyAId, sharedId].sort());
        expect(updatedA.items.find((item) => item.id === onlyAId)).toMatchObject({ status: 'read', readAt: expect.any(String) });
        expect(updatedA.items.find((item) => item.id === sharedId)).toMatchObject({ status: 'unread', readAt: null });
        const updatedB = await listMessages(request, tokenB);
        expect(updatedB.items.map((item) => item.id).sort()).toEqual([onlyBId, sharedId].sort());
        expect(updatedB.items.find((item) => item.id === onlyBId)).toMatchObject({ status: 'unread', readAt: null });
        expect(updatedB.items.find((item) => item.id === sharedId)).toMatchObject({ status: 'read', readAt: sharedReadAt });
      });
    } finally {
      await withClient(async (client) => {
        await client.query('delete from message_recipients where message_id = any($1::uuid[])', [messageIds]);
        await client.query('delete from messages where id = any($1::uuid[])', [messageIds]);
        await client.query('delete from sessions where user_id = any($1::uuid[])', [userIds]);
        await client.query('delete from user_acls where user_id = any($1::uuid[])', [userIds]);
        await client.query('delete from user_roles where user_id = any($1::uuid[])', [userIds]);
        await client.query('delete from users where id = any($1::uuid[])', [userIds]);
        if (organizationId) await client.query('delete from organizations where id = $1', [organizationId]);
      });
    }
  });
});
