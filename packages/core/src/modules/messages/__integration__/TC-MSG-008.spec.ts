import { expect, test } from '@playwright/test';

/**
 * TC-MSG-008: Public Message Email Link Token View
 * Source: .ai/qa/scenarios/TC-MSG-008-public-message-email-link-token-view.md
 */
test.describe('TC-MSG-008: Public Message Email Link Token View', () => {
  test('should show localized error state for invalid token link', async ({ page }) => {
    await page.goto(`/messages/view/qa-invalid-token-${Date.now()}`);

    await expect(page.getByRole('heading', { name: 'Message' })).toBeVisible();
    await expect(
      page.getByText(/(Invalid or expired link|This message link is invalid or has already been used\.)/i),
    ).toBeVisible();
  });
});
