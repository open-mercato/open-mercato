import { expect, type Locator, type Page, type Response } from '@playwright/test'

const DEFAULT_UI_TIMEOUT_MS = 10_000

// A React-controlled input renders whatever its state says. A fill that lands
// before hydration writes only the DOM, and the hydration render then restores
// the initial state value — the field empties again a few dozen milliseconds
// later, with the same DOM node. Checking the value once right after the fill
// reads the window before that happens and reports success on a value the app
// is about to discard, which is how TC-UMES-E17 came to probe with an empty
// person id and assert against whichever record the unfiltered query returned
// first. Re-check after this settle window and let the loop retype.
const CONTROLLED_INPUT_SETTLE_MS = 400

export async function fillControlledInput(
  input: Locator,
  value: string,
  timeoutMs = DEFAULT_UI_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null

  while (Date.now() < deadline) {
    try {
      await input.scrollIntoViewIfNeeded().catch(() => {})
      await input.click({ timeout: 2_000 })
      await input.fill(value)
      await expect(input).toHaveValue(value, { timeout: 1_500 })
      await input.page().waitForTimeout(CONTROLLED_INPUT_SETTLE_MS)
      await expect(input).toHaveValue(value, { timeout: 1_500 })
      return
    } catch (error) {
      lastError = error
      await input.page().waitForTimeout(150)
    }
  }

  if (lastError instanceof Error) {
    throw lastError
  }
  throw new Error(`Unable to fill controlled input with value "${value}"`)
}

export async function waitForApiMutation(
  page: Page,
  pathFragment: string,
  action: () => Promise<void>,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
  timeoutMs = DEFAULT_UI_TIMEOUT_MS,
): Promise<Response> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      response.url().includes(pathFragment),
    { timeout: timeoutMs },
  )

  await action()
  return responsePromise
}
