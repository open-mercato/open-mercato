import { expect, test, type Locator, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import {
  createCustomerGroupFixture,
  deleteCustomerGroupIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures';

export const integrationMeta = {
  dependsOnModules: ['customer_groups', 'catalog', 'push_notifications'],
};

/**
 * TC-UI-002: list consumers that render their own date-time `cell` (PR #7681, issue #8567)
 * show a locale-formatted value — never the raw ISO string — in the cell and in the
 * truncated-cell tooltip, in `en` and `pl`, and the date column stays reachable at a
 * 390x844 viewport.
 *
 * Expected strings are produced in the browser with the same `Intl.DateTimeFormat`
 * options `formatDisplayDateTime` uses (`dateStyle: 'medium'`, `timeStyle: 'short'`),
 * from the timestamp stored in the database, so the assertions hold in any time zone.
 *
 * Push delivery rows have no write API (they are produced only by the push strategy +
 * send-push worker), so they are seeded directly via SQL exactly like TC-PUSH-001. A SQL
 * write bypasses the CRUD list cache invalidation (`ENABLE_CRUD_API_CACHE` is on in the
 * integration env), so the page's list request gets a unique, ignored query param — the
 * response still comes from the real API, just never from a stale cache entry.
 *
 * The truncated-cell tooltip only mounts when the cell overflows, and whether a formatted
 * value overflows the default 120px date column depends on locale and font, so the spec
 * narrows the target cell with a constructable stylesheet rule (CSP-safe, and it survives
 * TruncatedCell remounting its content node) before hovering.
 */

const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const NARROW_CELL_ATTRIBUTE = 'data-qa-tc-ui-002-narrow';
const PUSH_DELIVERIES_PATH = '/api/push_notifications/deliveries';

type LocaleCase = {
  locale: 'en' | 'pl';
  updatedHeader: string;
  pushCreatedHeader: string;
  pushSentHeader: string;
};

const LOCALE_CASES: LocaleCase[] = [
  { locale: 'en', updatedHeader: 'Updated', pushCreatedHeader: 'Created', pushSentHeader: 'Sent' },
  { locale: 'pl', updatedHeader: 'Zaktualizowano', pushCreatedHeader: 'Utworzono', pushSentHeader: 'Wysłano' },
];

function baseUrl(): string {
  return process.env.BASE_URL || 'http://localhost:3000';
}

async function setLocaleCookie(page: Page, locale: string): Promise<void> {
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl() }]);
}

async function expectedDateTime(page: Page, iso: string, locale: string): Promise<string> {
  return page.evaluate(
    ({ value, lang }) =>
      new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)),
    { value: iso, lang: locale },
  );
}

async function readTimestamp(sql: string, id: string): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ value: Date | string | null }>(sql, [id]);
    const value = result.rows[0]?.value ?? null;
    if (value === null) throw new Error(`[internal] timestamp missing for ${id}`);
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  });
}

async function columnCell(page: Page, row: Locator, header: string): Promise<Locator> {
  const headerTexts = await page.locator('table thead th').allInnerTexts();
  const index = headerTexts.findIndex((text) => text.trim() === header);
  expect(index, `column "${header}" should be rendered (headers: ${headerTexts.join(' | ')})`).toBeGreaterThanOrEqual(0);
  return row.locator('td').nth(index);
}

async function expectFormattedCell(cell: Locator, expected: string): Promise<void> {
  await expect(cell).toHaveText(expected);
  const text = (await cell.innerText()).trim();
  expect(text.length).toBeGreaterThan(0);
  expect(text).not.toMatch(ISO_TIMESTAMP_PATTERN);
}

async function expectTooltipShowsFormattedValue(page: Page, cell: Locator, expected: string): Promise<void> {
  await expect(cell.locator('div.text-ellipsis').first()).toBeVisible();
  await cell.evaluate((element, attribute) => {
    element.setAttribute(attribute, '');
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`td[${attribute}] div.text-ellipsis { max-width: 48px !important; }`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, NARROW_CELL_ATTRIBUTE);
  await expect
    .poll(async () => {
      await page.mouse.move(0, 0);
      await cell.locator('div.text-ellipsis').first().hover();
      return page.getByRole('tooltip').first().textContent({ timeout: 1_500 }).catch(() => null);
    }, { timeout: 15_000 })
    .toBe(expected);
  const tooltipText = (await page.getByRole('tooltip').first().textContent()) ?? '';
  expect(tooltipText).not.toMatch(ISO_TIMESTAMP_PATTERN);
  await page.mouse.move(0, 0);
}

async function expectReachableOnMobile(page: Page, cell: Locator, expected: string): Promise<void> {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await cell.scrollIntoViewIfNeeded();
  await expect(cell).toBeInViewport();
  await expect(cell).toHaveText(expected);
}

async function searchList(page: Page, value: string): Promise<void> {
  const search = page.getByRole('searchbox').first();
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(value);
}

test.describe('TC-UI-002: custom DataTable date-time cells across list consumers', () => {
  for (const localeCase of LOCALE_CASES) {
    test(`customer groups "updated_at" renders a formatted date-time (${localeCase.locale})`, async ({ page, request }) => {
      const token = await getAuthToken(request, 'admin');
      const stamp = `${Date.now()}-${localeCase.locale}`;
      const code = `qa-ui-002-${stamp}`;
      let groupId: string | null = null;
      try {
        groupId = await createCustomerGroupFixture(request, token, {
          code,
          name: `QA UI 002 Group ${stamp}`,
          kind: 'b2c',
          isActive: true,
        });
        const updatedAt = await readTimestamp('select updated_at as value from customer_groups where id = $1', groupId);

        await login(page, 'admin');
        await setLocaleCookie(page, localeCase.locale);
        await page.goto('/backend/customer-groups', { waitUntil: 'domcontentloaded' });
        await searchList(page, code);
        const row = page.getByRole('row').filter({ hasText: code }).first();
        await expect(row).toBeVisible({ timeout: 20_000 });

        const expected = await expectedDateTime(page, updatedAt, localeCase.locale);
        const cell = await columnCell(page, row, localeCase.updatedHeader);
        await expectFormattedCell(cell, expected);
        await expectTooltipShowsFormattedValue(page, cell, expected);
        await expectReachableOnMobile(page, cell, expected);
      } finally {
        await deleteCustomerGroupIfExists(request, token, groupId);
      }
    });

    test(`catalog products "updated_at" renders a formatted date-time (${localeCase.locale})`, async ({ page, request }) => {
      const token = await getAuthToken(request, 'admin');
      const stamp = `${Date.now()}-${localeCase.locale}`;
      const title = `QA UI 002 Product ${stamp}`;
      let productId: string | null = null;
      try {
        productId = await createProductFixture(request, token, { title, sku: `QA-UI-002-${stamp}` });
        const updatedAt = await readTimestamp('select updated_at as value from catalog_products where id = $1', productId);

        await login(page, 'admin');
        await setLocaleCookie(page, localeCase.locale);
        await page.goto('/backend/catalog/products', { waitUntil: 'domcontentloaded' });
        await searchList(page, title);
        const row = page.getByRole('row').filter({ hasText: title }).first();
        await expect(row).toBeVisible({ timeout: 20_000 });

        const expected = await expectedDateTime(page, updatedAt, localeCase.locale);
        const cell = await columnCell(page, row, localeCase.updatedHeader);
        await expectFormattedCell(cell, expected);
        await expectTooltipShowsFormattedValue(page, cell, expected);
        await expectReachableOnMobile(page, cell, expected);
      } finally {
        await deleteCatalogProductIfExists(request, token, productId);
      }
    });

    test(`push deliveries "created_at"/"sent_at" render formatted values and a null Sent fallback (${localeCase.locale})`, async ({ page, request }) => {
      const token = await getAuthToken(request, 'admin');
      const { tenantId, organizationId, userId } = getTokenScope(token);
      const stamp = `${Date.now()}_${localeCase.locale}`;
      const sentType = `qa.tc_ui_002_sent_${stamp}`;
      const pendingType = `qa.tc_ui_002_pending_${stamp}`;
      const seededIds: string[] = [];
      try {
        await withClient(async (client) => {
          for (const fixture of [
            { type: sentType, status: 'sent', sent: true },
            { type: pendingType, status: 'pending', sent: false },
          ]) {
            const result = await client.query<{ id: string }>(
              `insert into push_notification_deliveries
                 (tenant_id, organization_id, notification_id, notification_type_id, user_device_id, user_id,
                  provider, token_snapshot, status, attempts, payload, provider_response, created_at, sent_at, updated_at)
               values ($1, $2, gen_random_uuid(), $3, gen_random_uuid(), $4, 'push_stub', 'QAUI0002', $5, 1,
                       '{}'::jsonb, null, now(), case when $6 then now() else null end, now())
               returning id`,
              [tenantId, organizationId || null, fixture.type, userId, fixture.status, fixture.sent],
            );
            seededIds.push(result.rows[0].id);
          }
        });
        const [sentId, pendingId] = seededIds;
        const sentCreatedAt = await readTimestamp('select created_at as value from push_notification_deliveries where id = $1', sentId);
        const sentAt = await readTimestamp('select sent_at as value from push_notification_deliveries where id = $1', sentId);
        const pendingCreatedAt = await readTimestamp('select created_at as value from push_notification_deliveries where id = $1', pendingId);

        await login(page, 'admin');
        await setLocaleCookie(page, localeCase.locale);
        await page.route(
          (url) => url.pathname === PUSH_DELIVERIES_PATH,
          async (route) => {
            const url = new URL(route.request().url());
            url.searchParams.set('qaCacheBust', stamp);
            await route.continue({ url: url.toString() });
          },
        );
        await page.goto('/backend/push_notifications', { waitUntil: 'domcontentloaded' });
        const sentRow = page.getByRole('row').filter({ hasText: sentType }).first();
        const pendingRow = page.getByRole('row').filter({ hasText: pendingType }).first();
        await expect(sentRow).toBeVisible({ timeout: 20_000 });
        await expect(pendingRow).toBeVisible({ timeout: 20_000 });

        const expectedSentCreated = await expectedDateTime(page, sentCreatedAt, localeCase.locale);
        const expectedSentAt = await expectedDateTime(page, sentAt, localeCase.locale);
        const expectedPendingCreated = await expectedDateTime(page, pendingCreatedAt, localeCase.locale);

        await expectFormattedCell(await columnCell(page, sentRow, localeCase.pushCreatedHeader), expectedSentCreated);
        const sentCell = await columnCell(page, sentRow, localeCase.pushSentHeader);
        await expectFormattedCell(sentCell, expectedSentAt);
        await expectFormattedCell(await columnCell(page, pendingRow, localeCase.pushCreatedHeader), expectedPendingCreated);
        await expect(await columnCell(page, pendingRow, localeCase.pushSentHeader)).toHaveText('—');

        await expectTooltipShowsFormattedValue(page, sentCell, expectedSentAt);
        await expectReachableOnMobile(page, sentCell, expectedSentAt);
      } finally {
        if (seededIds.length > 0) {
          await withClient(async (client) => {
            await client.query('delete from push_notification_deliveries where id = any($1::uuid[])', [seededIds]);
          }).catch(() => undefined);
        }
      }
    });
  }
});
