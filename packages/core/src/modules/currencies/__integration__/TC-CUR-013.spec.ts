import { expect, test, type APIRequestContext } from '@playwright/test';
import { createFetchConfigFixture } from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CUR-013: Currency-fetching provider toggle routes through the guarded mutation
 * Covers: the fetch-config provider toggle (PUT) refactored in PR #3438 (fixes #3191) —
 * `components/CurrencyFetchingConfig.tsx` `toggleEnabled` now runs through
 * `useGuardedMutation(...).runMutation(...)`.
 *
 * Committed follow-up to the `om-auto-verify-pr-ui` run on #3438, which exercised this
 * flow with a throwaway spec ("toggle a provider on → 'Provider enabled' flash").
 *
 * The toggle PUT carries the record id in the body (the fetch-configs route reads it from
 * the body, unlike the `?id=` delete bug), so the happy path succeeds: the guarded PUT
 * flips the switch on and the page flashes "Provider enabled".
 */
type FetchConfig = { id: string; provider: string; isEnabled: boolean };

const NBP_PROVIDER = 'NBP';
const NBP_HEADING = /National Bank of Poland/;

async function readNbpConfig(
  request: APIRequestContext,
  token: string,
): Promise<FetchConfig | null> {
  const response = await apiRequest(request, 'GET', '/api/currencies/fetch-configs', { token });
  const body = (await response.json()) as { configs?: FetchConfig[] };
  return body.configs?.find((config) => config.provider === NBP_PROVIDER) ?? null;
}

test.describe('TC-CUR-013: Currency-fetching provider toggle routes through the guarded mutation', () => {
  test('toggling a provider on flashes "Provider enabled" and persists via the guarded PUT', async ({ page, request }) => {
    // Login + config-page initialization + a guarded PUT do not fit the default 30s
    // budget under parallel CI shard load; 60s matches the other UI specs.
    test.setTimeout(60_000);

    let token: string | null = null;
    let configId: string | null = null;
    let createdByTest = false;
    let originalEnabled = false;

    try {
      token = await getAuthToken(request, 'admin');

      // Deterministic precondition: an NBP fetch-config that exists and is disabled,
      // so toggling it from the UI is unambiguously an "enable" → "Provider enabled".
      const existing = await readNbpConfig(request, token);
      if (existing) {
        configId = existing.id;
        originalEnabled = existing.isEnabled;
        if (existing.isEnabled) {
          await apiRequest(request, 'PUT', '/api/currencies/fetch-configs', {
            token,
            data: { id: existing.id, isEnabled: false },
          });
        }
      } else {
        configId = await createFetchConfigFixture(request, token, { provider: NBP_PROVIDER, isEnabled: false });
        createdByTest = true;
      }

      await login(page, 'admin');
      await page.goto('/backend/config/currency-fetching');

      // Scope to the NBP provider card (`bg-card` is the DS card container) so we target
      // only its switch, never the other provider's.
      const nbpCard = page.locator('.bg-card').filter({
        has: page.getByRole('heading', { name: NBP_HEADING }),
      });
      await expect(nbpCard).toHaveCount(1, { timeout: 15_000 });

      const nbpSwitch = nbpCard.getByRole('switch');
      await expect(nbpSwitch).toHaveAttribute('aria-checked', 'false', { timeout: 10_000 });

      await nbpSwitch.click();

      await expect(page.getByText('Provider enabled').first()).toBeVisible({ timeout: 10_000 });
      await expect(nbpSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 10_000 });

      // The guarded PUT persisted: the provider is enabled via the API too.
      await expect
        .poll(
          async () => {
            const config = await readNbpConfig(request, token as string);
            return config?.isEnabled ?? false;
          },
          { timeout: 10_000 },
        )
        .toBe(true);
    } finally {
      // Restore the provider to its original state so the run is repeatable.
      if (token && configId) {
        if (createdByTest) {
          await deleteFetchConfig(request, token, configId).catch(() => {});
        } else {
          await apiRequest(request, 'PUT', '/api/currencies/fetch-configs', {
            token,
            data: { id: configId, isEnabled: originalEnabled },
          }).catch(() => {});
        }
      }
    }
  });
});

// Best-effort cleanup for a config this test created. The fetch-configs route may not
// expose DELETE; the swallowed error keeps teardown from masking a real failure.
async function deleteFetchConfig(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<void> {
  await apiRequest(request, 'DELETE', `/api/currencies/fetch-configs?id=${encodeURIComponent(id)}`, { token });
}
