import { test as base } from '@e2edev/playwright';
import { expect, credentials } from 'e2e';
import { noticeAckCookies } from './support/fixtures';

/**
 * Signs in each demo persona once and saves the session. Every other test
 * declares `{ session: 'admin' }` (or 'employee') instead of logging in, which
 * keeps the login rate limit (5 attempts / 60 s per email) out of the suite.
 *
 * Deterministic on purpose: a login form takes exact values, and filling the
 * secret here keeps screenshot evidence intact in the real tests.
 */
const PERSONAS = ['admin', 'employee'] as const;

base.setup('sign in the demo personas', { sessions: [...PERSONAS] }, async ({ app, screen, session, web }) => {
  for (const [index, name] of PERSONAS.entries()) {
    if (index > 0) await app.clearState();
    const user = credentials.user(name);

    await web.setCookies(noticeAckCookies(app.baseUrl!));
    await app.open('/login');
    await screen.getByLabel('Email').fill(user.username);
    await screen.getByLabel('Password', { exact: true }).fill(user.password);
    await screen.getByRole('button', { name: 'Sign in' }).tap();

    await expect(web).toHaveURL(/\/backend(?:[/?#].*)?$/, { timeout: 60_000 });
    await expect(screen.getByRole('button', { name: user.username })).toBeVisible({ timeout: 30_000 });

    await session.save(name);
  }
});
