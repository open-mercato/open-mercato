import { expect, type Locator, type Page } from '@playwright/test'

export function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function waitForWmsMutationAccess(page: Page) {
  await page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/auth/feature-check') &&
      response.ok(),
    { timeout: 15_000 },
  )
}

export async function waitForInventoryMutationScope(page: Page) {
  const operationsHeading = page
    .getByRole('heading', {
      level: 2,
      name: /Inventory operations|Operacje magazynowe/i,
    })
    .first()

  const alreadyVisible = await operationsHeading.isVisible().catch(() => false)
  if (!alreadyVisible) {
    await page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/auth/feature-check') &&
        response.ok(),
      { timeout: 15_000 },
    )
  }

  await expect(operationsHeading).toBeVisible({ timeout: 15_000 })
}

export async function expectDialogHasNoFieldErrors(dialog: Locator) {
  await expect(dialog.getByRole('alert')).toHaveCount(0, { timeout: 5_000 })
}

export async function waitForDialogSubmitReady(dialog: Locator, submitTestId: string) {
  const submit = dialog.getByTestId(submitTestId)
  await expect(submit).toBeVisible({ timeout: 10_000 })
  await expect(submit).toBeEnabled({ timeout: 10_000 })
  await expectDialogHasNoFieldErrors(dialog)
}

async function collectInventoryDialogSubmitDiagnostics(page: Page, dialog: Locator) {
  const fieldErrors = await dialog.getByRole('alert').allTextContents()
  const dialogText = await dialog.innerText().catch(() => '')
  const flashText = await page
    .locator('[data-sonner-toast], [role="status"]')
    .allTextContents()
    .catch(() => [] as string[])
  return { fieldErrors, flashText, dialogText }
}

export async function submitInventoryDialog(
  page: Page,
  dialog: Locator,
  options: {
    submitTestId: string
    apiPath: string
    method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    timeoutMs?: number
  },
) {
  await waitForDialogSubmitReady(dialog, options.submitTestId)
  const submit = dialog.getByTestId(options.submitTestId)
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === (options.method ?? 'POST') &&
      response.url().includes(options.apiPath),
    { timeout: options.timeoutMs ?? 20_000 },
  )
  await submit.click()
  try {
    return await responsePromise
  } catch (error) {
    const diagnostics = await collectInventoryDialogSubmitDiagnostics(page, dialog)
    throw new Error(
      `Expected ${options.method ?? 'POST'} ${options.apiPath} after dialog submit. ` +
        `fieldErrors=${JSON.stringify(diagnostics.fieldErrors)} ` +
        `flash=${JSON.stringify(diagnostics.flashText)} ` +
        `dialog=${JSON.stringify(diagnostics.dialogText.slice(0, 800))}`,
      { cause: error },
    )
  }
}

export async function fillCombobox(
  page: Page,
  placeholder: string,
  value: string,
  options?: {
    scope?: Locator
    waitForEnabledPlaceholder?: string
    suggestionsApiPath?: string
  },
) {
  const root = options?.scope ?? page
  const input = root.getByPlaceholder(placeholder, { exact: true })
  await expect(input).toBeEnabled({ timeout: 10_000 })
  await input.click()

  const suggestionsResponse = options?.suggestionsApiPath
    ? page
        .waitForResponse(
          (response) =>
            response.request().method() === 'GET' &&
            response.url().includes(options.suggestionsApiPath!) &&
            response.ok(),
          { timeout: 15_000 },
        )
        .catch(() => null)
    : null

  await input.fill(value)
  if (suggestionsResponse) {
    await suggestionsResponse
  }

  const suggestionPattern = new RegExp(escapeForRegex(value), 'i')
  const suggestionInDropdown = input
    .locator('xpath=ancestor::div[contains(@class,"relative")][1]')
    .locator('div.absolute')
    .getByRole('button', { name: suggestionPattern })
    .first()

  const hasDropdownSuggestion = await suggestionInDropdown
    .isVisible({ timeout: 2_000 })
    .catch(() => false)

  if (hasDropdownSuggestion) {
    await suggestionInDropdown.click()
  } else {
    await input.press('ArrowDown')
    const selectedWithKeyboard = await input
      .inputValue()
      .then((current) => current.trim().toLowerCase() === value.trim().toLowerCase())
      .catch(() => false)
    if (!selectedWithKeyboard) {
      await input.press('Enter')
    }
    const resolvedValue = await input.inputValue()
    if (resolvedValue.trim().toLowerCase() !== value.trim().toLowerCase()) {
      const fallbackSuggestion = root.getByRole('button', { name: suggestionPattern }).first()
      await expect(fallbackSuggestion).toBeVisible({ timeout: 10_000 })
      await fallbackSuggestion.click()
    }
  }

  await expect(input).toHaveValue(value, { timeout: 5_000 })
  await input.press('Tab')

  if (options?.scope) {
    await expectDialogHasNoFieldErrors(options.scope)
  }

  if (options?.waitForEnabledPlaceholder) {
    await expect(
      root.getByPlaceholder(options.waitForEnabledPlaceholder, { exact: true }),
    ).toBeEnabled({
      timeout: 10_000,
    })
  }
}

export async function selectLocationComboboxOption(
  page: Page,
  dialog: Locator,
  placeholder: string,
  locationCode: string,
) {
  const input = dialog.getByPlaceholder(placeholder)
  await expect(input).toBeEnabled({ timeout: 10_000 })
  await input.click()

  const locationsResponse = page
    .waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/wms/locations') &&
        response.url().includes('search=') &&
        response.ok(),
      { timeout: 15_000 },
    )
    .catch(() => null)

  await input.fill(locationCode)
  await locationsResponse
  await page.waitForTimeout(350)

  const dropdown = input
    .locator('xpath=ancestor::div[contains(@class,"relative")][1]')
    .locator('div.absolute')
  const option = dropdown.getByRole('button', { name: locationCode, exact: true })
  if (await option.isVisible().catch(() => false)) {
    await option.click()
  } else {
    await page.getByRole('button', { name: locationCode, exact: true }).click()
  }

  await expect(input).toHaveValue(locationCode, { timeout: 5_000 })
  await expectDialogHasNoFieldErrors(dialog)
}

export async function selectDialogOption(
  dialog: Locator,
  page: Page,
  optionLabel: string | RegExp,
  options?: { fieldLabel?: string | RegExp },
) {
  const trigger = options?.fieldLabel
    ? dialog
        .locator('[data-slot="form-field"]')
        .filter({ hasText: options.fieldLabel })
        .getByRole('combobox')
        .first()
    : dialog.getByRole('combobox').last()
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  await trigger.click()
  const listbox = page.getByRole('listbox').last()
  await expect(listbox).toBeVisible({ timeout: 10_000 })
  const option = listbox.getByRole('option', { name: optionLabel })
  await expect(option).toBeVisible({ timeout: 10_000 })
  await option.click()
  await expect(listbox).toBeHidden({ timeout: 5_000 })
  if (typeof optionLabel === 'string') {
    await expect(trigger).toContainText(optionLabel, { timeout: 5_000 })
  }
  await expectDialogHasNoFieldErrors(dialog)
}

export const WMS_INVENTORY_MUTATION_FEATURES = [
  'wms.view',
  'wms.manage_warehouses',
  'wms.manage_locations',
  'wms.manage_zones',
  'wms.manage_inventory',
  'wms.adjust_inventory',
  'wms.cycle_count',
] as const

export const WMS_INVENTORY_CONSOLE_ROW_ACTION_FEATURES = [
  ...WMS_INVENTORY_MUTATION_FEATURES,
  'wms.manage_reservations',
] as const

export const WMS_IMPORT_FEATURES = [...WMS_INVENTORY_MUTATION_FEATURES, 'wms.import'] as const

export type WmsInventoryConsoleTable = 'balances' | 'reservations'

const INVENTORY_CONSOLE_SECTION_HEADING: Record<WmsInventoryConsoleTable, RegExp> = {
  balances: /Inventory balances|Stany magazynowe/i,
  reservations: /Inventory reservations|Rezerwacje zapasu/i,
}

const INVENTORY_CONSOLE_SEARCH_PLACEHOLDER: Record<WmsInventoryConsoleTable, RegExp> = {
  balances: /Search balances|Szukaj stanów/i,
  reservations: /Search reservations|Szukaj rezerwacji/i,
}

export const WMS_INVENTORY_ROW_ACTION_LABELS = {
  move: /^Move$|^Przenieś$/i,
  release: /^Release$|^Zwolnij$/i,
  openActions: /^Open actions$|^Otwórz akcje$|^Aktionen öffnen$|^Abrir acciones$/i,
} as const

export function inventoryConsoleSection(page: Page, table: WmsInventoryConsoleTable) {
  return page.locator('section').filter({
    has: page.getByRole('heading', { level: 2, name: INVENTORY_CONSOLE_SECTION_HEADING[table] }),
  })
}

export async function ensureEnglishLocale(page: Page) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  await page.context().addCookies([
    {
      name: 'locale',
      value: 'en',
      url: baseUrl,
      sameSite: 'Lax',
    },
  ])
}

export async function filterInventoryConsoleTable(
  page: Page,
  table: WmsInventoryConsoleTable,
  searchText: string,
) {
  const section = inventoryConsoleSection(page, table)
  const searchInput = section.getByRole('textbox', {
    name: INVENTORY_CONSOLE_SEARCH_PLACEHOLDER[table],
  })
  await expect(searchInput).toBeVisible({ timeout: 10_000 })
  await searchInput.fill(searchText)
}

export async function openInventoryConsoleRowAction(
  page: Page,
  table: WmsInventoryConsoleTable,
  rowLabel: string,
  actionName: RegExp,
  options?: { extraRowText?: string | RegExp; search?: boolean },
) {
  const section = inventoryConsoleSection(page, table)
  if (options?.search !== false) {
    await filterInventoryConsoleTable(page, table, rowLabel)
  }
  let row = section.getByRole('row').filter({ hasText: rowLabel })
  if (options?.extraRowText) {
    row = row.filter({ hasText: options.extraRowText })
  }
  const targetRow = row.first()
  await expect(targetRow).toBeVisible({ timeout: 15_000 })
  await targetRow.scrollIntoViewIfNeeded()

  const actionsButton = targetRow.getByRole('button', {
    name: WMS_INVENTORY_ROW_ACTION_LABELS.openActions,
  })
  await expect(actionsButton).toBeVisible({ timeout: 10_000 })
  await actionsButton.focus()
  await actionsButton.press('Enter')

  const menu = page.getByRole('menu').first()
  await expect(menu).toBeVisible({ timeout: 10_000 })
  const menuItem = menu.getByRole('menuitem', { name: actionName })
  await expect(menuItem).toBeVisible({ timeout: 10_000 })
  await menuItem.click()
}
