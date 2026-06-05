import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-API-MSG-019: Metadata Endpoints — Types and Object Types Registration
 * Surfaces:
 *  - api/types/route.ts (GET, messages.view)
 *  - api/object-types/route.ts (GET, messages.compose)
 *
 * Both endpoints expose static registry data. They require authentication, and
 * object-types requires a `messageType` query parameter (400 when missing).
 */
const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000';

test.describe('TC-API-MSG-019: Metadata Endpoints', () => {
  test('should expose registered message types to authenticated callers only', async ({ request }) => {
    const unauth = await request.get(`${BASE_URL}/api/messages/types`);
    expect(unauth.status()).toBe(401);

    const token = await getAuthToken(request, 'admin');
    const response = await apiRequest(request, 'GET', '/api/messages/types', { token });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      items?: Array<{
        type?: unknown;
        module?: unknown;
        labelKey?: unknown;
        icon?: unknown;
        allowReply?: unknown;
        allowForward?: unknown;
      }>;
    };
    expect(Array.isArray(body.items)).toBe(true);
    expect((body.items ?? []).length).toBeGreaterThan(0);

    const defaultType = (body.items ?? []).find((item) => item.type === 'default');
    expect(defaultType).toBeTruthy();
    expect(defaultType?.module).toBe('messages');
    expect(typeof defaultType?.labelKey).toBe('string');
    expect(typeof defaultType?.icon).toBe('string');
    expect(typeof defaultType?.allowReply).toBe('boolean');
    expect(typeof defaultType?.allowForward).toBe('boolean');
  });

  test('should require auth and a messageType query for object-types', async ({ request }) => {
    const unauth = await request.get(`${BASE_URL}/api/messages/object-types?messageType=default`);
    expect(unauth.status()).toBe(401);

    const token = await getAuthToken(request, 'admin');

    // Missing required query param -> 400.
    const missingParam = await apiRequest(request, 'GET', '/api/messages/object-types', { token });
    expect(missingParam.status()).toBe(400);
    const missingParamBody = (await missingParam.json()) as { error?: unknown };
    expect(typeof missingParamBody.error).toBe('string');

    // Valid request returns an items array (the core baseline registers none, so
    // emptiness is acceptable — the contract is the shape, not the contents).
    const response = await apiRequest(request, 'GET', '/api/messages/object-types?messageType=default', { token });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { items?: Array<{ module?: unknown; entityType?: unknown }> };
    expect(Array.isArray(body.items)).toBe(true);
    for (const item of body.items ?? []) {
      expect(typeof item.module).toBe('string');
      expect(typeof item.entityType).toBe('string');
    }
  });
});
