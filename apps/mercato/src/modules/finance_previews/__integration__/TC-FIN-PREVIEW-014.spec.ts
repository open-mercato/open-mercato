import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { login } from '@open-mercato/core/helpers/integration/auth'

const screens = [
  'screens',
  'ledger-spec-screens',
  'operations-spec-screens',
  'tax-spec-screens',
].flatMap(
  (name) =>
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL(`../data/${name}.json`, import.meta.url)),
        'utf8',
      ),
    ) as { id: string; title: string }[],
)

for (const width of [1440, 390]) {
  test(`accountant workflows fit a ${width}px viewport without clipped form controls`, async ({
    page,
  }) => {
    await login(page, 'superadmin')
    await page.goto('/backend/finance-preview#s44')
    const root = page.getByTestId('finance-preview')
    await expect(root).toHaveAttribute('aria-busy', 'false')
    await page.setViewportSize({ width, height: 1000 })
    for (const screen of [
      10,
      ...Array.from({ length: 14 }, (_, index) => index + 44),
    ]) {
      const title = screens.find((item) => item.id === `s${screen}`)?.title
      if (!title) throw new Error('[internal] Missing screen title')
      await page.evaluate((id) => {
        window.location.hash = id
      }, `s${screen}`)
      await expect(
        root.getByRole('heading', { name: title, exact: true, level: 1 }),
      ).toBeVisible()
      await expect
        .poll(async () =>
          page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          ),
        )
        .toBeLessThanOrEqual(1)
      const wrongPrimary = await root
        .locator('button[type="submit"]')
        .evaluateAll((buttons) =>
          buttons.flatMap((button) => {
            if (!button.getBoundingClientRect().width) return []
            const reference = document.createElement('span')
            reference.style.color = 'var(--status-info-solid)'
            button.append(reference)
            const expected = getComputedStyle(reference).color
            reference.remove()
            return getComputedStyle(button).backgroundColor === expected
              ? []
              : [button.textContent]
          }),
        )
      expect(wrongPrimary, `submit color s${screen}`).toEqual([])
      const clipped = await root
        .locator(
          '[data-crud-field-id] input:not([aria-hidden="true"]), [data-crud-field-id] textarea, [data-crud-field-id] button[role="combobox"], [data-crud-field-id] button[role="checkbox"]',
        )
        .evaluateAll((controls) =>
          controls.flatMap((control) => {
            const box = control.getBoundingClientRect()
            const field = control
              .closest('[data-crud-field-id]')
              ?.getBoundingClientRect()
            if (!field || !box.width || !box.height) return []
            return box.left < field.left - 1 || box.right > field.right + 1
              ? [
                  control
                    .closest('[data-crud-field-id]')
                    ?.getAttribute('data-crud-field-id'),
                ]
              : []
          }),
        )
      expect(clipped, `s${screen} at ${width}px`).toEqual([])
      if ([10, 44, 46, 48, 52, 53, 57].includes(screen))
        await page.screenshot({
          path: test.info().outputPath(`finance-spec-s${screen}-${width}.png`),
          fullPage: true,
        })
    }
  })
}
