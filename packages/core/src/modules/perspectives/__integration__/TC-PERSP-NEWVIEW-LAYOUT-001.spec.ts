import { test, expect } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { isStandaloneIntegration } from '@open-mercato/core/helpers/integration/standaloneEnv'

export const integrationMeta = {
  dependsOnModules: ['perspectives', 'customers'],
}

/**
 * TC-PERSP-NEWVIEW-LAYOUT-001: the Views panel's "New view" control keeps its
 * confirm/cancel buttons vertically centred inside the name input — while the
 * name is still blank, and after the first character is typed (issue #5846,
 * deferred out of PR #5821).
 *
 * `NewViewForm` centres those buttons with `absolute right-1 top-1/2
 * -translate-y-1/2` inside a `relative` wrapper that also holds the input. Any
 * extra element added as a sibling *inside* that positioning context — #5821's
 * blank-name hint was exactly that — grows the wrapper and drags the buttons out
 * of the input, then lets them snap back on the first keystroke once the hint
 * unmounts. jsdom cannot see this: it has no layout engine, so
 * `getBoundingClientRect()` returns zeroes and the offset is invisible to the
 * unit tests. This browser case is the durable guard.
 *
 * It asserts geometry rather than DOM structure, so it stays valid across
 * restyles and across whatever the hint's final markup turns out to be: the only
 * contract is that the confirm button stays centred in the input and does not
 * jump when typing starts.
 */

const PEOPLE_LIST_PATH = '/backend/customers/people'

// Sub-pixel rounding and fractional line-height metrics can shift a centred box
// by a fraction of a pixel; the defect this guards against was a 10px offset.
const CENTRE_TOLERANCE_PX = 1.5

async function centreOffset(input: Locator, button: Locator): Promise<number> {
  const inputBox = await input.boundingBox()
  const buttonBox = await button.boundingBox()
  expect(inputBox, 'the view-name input should have a layout box').toBeTruthy()
  expect(buttonBox, 'the confirm button should have a layout box').toBeTruthy()
  const inputCentre = inputBox!.y + inputBox!.height / 2
  const buttonCentre = buttonBox!.y + buttonBox!.height / 2
  return Math.abs(buttonCentre - inputCentre)
}

test.describe('TC-PERSP-NEWVIEW-LAYOUT-001: New-view control keeps its buttons centred', () => {
  test('confirm button stays vertically centred in the name input, blank and after the first keystroke', async ({ page }) => {
    test.skip(isStandaloneIntegration(), 'Standalone smoke runs omit this monorepo-only Views panel layout check.')

    await login(page, 'admin')
    await page.goto(PEOPLE_LIST_PATH, { waitUntil: 'domcontentloaded' })
    await page
      .getByText('Loading table', { exact: false })
      .waitFor({ state: 'hidden', timeout: 10_000 })
      .catch(() => {})

    // Open the Views panel and enter "New view" mode.
    const openViews = page.getByTestId('data-table-open-views-sidebar').first()
    await expect(openViews).toBeVisible()
    await openViews.click()
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'New', exact: true }).click()

    const nameInput = page.getByPlaceholder('View name...')
    const confirmButton = page.getByRole('button', { name: 'Create view' })
    await expect(nameInput).toBeVisible()
    await expect(confirmButton).toBeVisible()

    // Let the panel settle so the measurement is not taken mid-transition.
    await page.waitForTimeout(250)

    const blankOffset = await centreOffset(nameInput, confirmButton)
    expect(
      blankOffset,
      'with a blank name the confirm button must sit centred in the input, not pushed below it',
    ).toBeLessThanOrEqual(CENTRE_TOLERANCE_PX)

    const blankButtonBox = await confirmButton.boundingBox()

    // Typing the first character is what used to make the buttons jump back into
    // place, because the blank-name hint unmounted and the wrapper shrank.
    await nameInput.pressSequentially('Q', { delay: 50 })
    await expect(nameInput).toHaveValue('Q')
    await page.waitForTimeout(250)

    const typedOffset = await centreOffset(nameInput, confirmButton)
    expect(
      typedOffset,
      'after the first keystroke the confirm button must still be centred in the input',
    ).toBeLessThanOrEqual(CENTRE_TOLERANCE_PX)

    const typedButtonBox = await confirmButton.boundingBox()
    expect(
      Math.abs(typedButtonBox!.y - blankButtonBox!.y),
      'the confirm button must not move vertically when the first character is typed',
    ).toBeLessThanOrEqual(CENTRE_TOLERANCE_PX)

    // The view was never submitted, so nothing was persisted and there is no
    // fixture to clean up.
  })
})
