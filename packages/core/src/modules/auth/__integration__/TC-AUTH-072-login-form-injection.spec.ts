import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_CREDENTIALS } from '@open-mercato/core/helpers/integration/auth';

/**
 * TC-AUTH-072: the `auth.login:form` injection spot renders on `/login` and can delegate the
 * sign-in to an alternative provider, while password login stays intact for every other email.
 *
 * The login page is served from the `login` client bootstrap profile. That profile has to load
 * the injection registry after hydration; when it does not, every `auth.login:form` contribution
 * (enterprise SSO included) is silently absent and the unit test on `groupsForProfile` cannot
 * tell. The example module ships `example.injection.login-provider-probe` on that spot: it is
 * inert unless the email ends in `@login-probe.example`, for which it sets an `AuthOverride`
 * that hides the password field and takes over the submit.
 *
 * Read-only: no fixtures are created and the probe never calls the login API.
 */

export const integrationMeta = { requiredModules: ['auth', 'example'] };

const PROBE_EMAIL = 'probe@login-probe.example';
const LOGIN_API_PATH = '/api/auth/login';

async function openLoginForm(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('form[data-auth-ready="1"]')).toBeVisible();
}

test.describe('TC-AUTH-072: login form injection spot', () => {
  test('mounts the contribution after the client bootstrap and lets it claim the sign-in', async ({ page }) => {
    const loginApiCalls: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === LOGIN_API_PATH) loginApiCalls.push(request.method());
    });

    await openLoginForm(page);

    const probe = page.getByTestId('example-login-provider-probe');
    await expect(probe, 'the login profile must load the injection registry so the spot renders its widgets').toBeAttached();
    await expect(probe).toHaveAttribute('data-active', '0');
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();

    await page.getByLabel('Email').fill(PROBE_EMAIL);

    await expect(page.getByTestId('example-login-provider-probe-active')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Remember me')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveCount(0);

    const submit = page.getByRole('button', { name: 'Continue with probe provider' });
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByTestId('example-login-provider-probe-submitted')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    expect(loginApiCalls, 'an active override must bypass the password login API').toEqual([]);

    await page.getByLabel('Email').fill(DEFAULT_CREDENTIALS.admin.email);
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByTestId('example-login-provider-probe')).toHaveAttribute('data-active', '0');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('keeps ordinary password login working when no contribution claims the email', async ({ page }) => {
    await openLoginForm(page);
    await expect(page.getByTestId('example-login-provider-probe')).toBeAttached();

    await page.getByLabel('Email').fill(DEFAULT_CREDENTIALS.admin.email);
    const password = page.getByLabel('Password', { exact: true });
    await expect(password).toBeVisible();
    await password.fill(DEFAULT_CREDENTIALS.admin.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.waitForURL(/\/backend(?:\/.*)?$/);
    await expect(page).toHaveURL(/\/backend/);
  });
});
