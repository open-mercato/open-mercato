import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createWebhookFixture,
  deleteWebhookIfExists,
  getWebhookDetail,
  rotateWebhookSecret,
} from './helpers/fixtures';

/**
 * TC-WEBHOOK-004: Secret rotation with previous secret retention
 * Source: https://github.com/open-mercato/open-mercato/issues/2482
 *
 * Verifies the security-critical rotate-secret flow: a new whsec_ secret is issued,
 * the previous secret is retained (so deliveries can dual-sign during rollout), and
 * the detail endpoint reflects the masked new secret plus the rotation timestamp.
 */
test.describe('TC-WEBHOOK-004: Secret rotation with previous secret retention', () => {
  test('should rotate the signing secret, retain the previous one, and mask it on read', async ({ request }) => {
    const token = await getAuthToken(request);
    let webhookId: string | null = null;

    try {
      const created = await createWebhookFixture(request, token, {
        name: `Webhook Rotate ${Date.now()}`,
        url: 'https://example.com/webhook-rotate',
        subscribedEvents: ['sales.quote.created'],
      });
      webhookId = created.id;
      expect(created.secret.startsWith('whsec_')).toBe(true);

      const beforeRotation = await getWebhookDetail(request, token, created.id);
      expect(beforeRotation.previousSecretSetAt).toBeNull();

      const rotation = await rotateWebhookSecret(request, token, created.id);
      expect(rotation.success).toBe(true);
      expect(rotation.secret.startsWith('whsec_')).toBe(true);
      expect(rotation.secret).not.toBe(created.secret);
      expect(typeof rotation.previousSecretSetAt).toBe('string');
      expect(Number.isNaN(Date.parse(rotation.previousSecretSetAt as string))).toBe(false);

      const afterRotation = await getWebhookDetail(request, token, created.id);
      // The detail endpoint never exposes the raw secret — only a masked form that
      // reveals the constant "whsec_" prefix (maskSecret => `${secret.slice(0, 6)}••••••••`).
      expect(afterRotation.maskedSecret.startsWith('whsec_')).toBe(true);
      expect(afterRotation.maskedSecret).not.toBe(rotation.secret);
      expect(afterRotation.maskedSecret).not.toBe(created.secret);
      expect(afterRotation.maskedSecret.length).toBeLessThan(rotation.secret.length);
      // previousSecretSetAt proves the prior secret is retained for dual-sign verification
      // (delivery signing reads webhook.previousSecret; covered at unit level in lib/__tests__).
      expect(afterRotation.previousSecretSetAt).toBe(rotation.previousSecretSetAt);

      const secondRotation = await rotateWebhookSecret(request, token, created.id);
      expect(secondRotation.secret).not.toBe(rotation.secret);
      expect(typeof secondRotation.previousSecretSetAt).toBe('string');
      expect(Date.parse(secondRotation.previousSecretSetAt as string)).toBeGreaterThanOrEqual(
        Date.parse(rotation.previousSecretSetAt as string),
      );
    } finally {
      await deleteWebhookIfExists(request, token, webhookId);
    }
  });
});
