import { expect, type Locator, type Page } from '@playwright/test'

export function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function fillCombobox(
  page: Page,
  placeholder: string,
  value: string,
  options?: { scope?: Locator; waitForEnabledPlaceholder?: string },
) {
  const root = options?.scope ?? page
  const input = root.getByPlaceholder(placeholder)
  await expect(input).toBeEnabled({ timeout: 10_000 })
  await input.click()
  await input.fill(value)
  const suggestion = page
    .getByRole('button', {
      name: new RegExp(escapeForRegex(value), 'i'),
    })
    .first()
  const suggestionVisible = await suggestion.waitFor({ state: 'visible', timeout: 2_000 }).then(
    () => true,
    () => false,
  )
  if (suggestionVisible) {
    await suggestion.click()
  } else {
    await input.press('Enter')
  }
  await input.press('Tab')
  if (options?.waitForEnabledPlaceholder) {
    await expect(root.getByPlaceholder(options.waitForEnabledPlaceholder)).toBeEnabled({
      timeout: 10_000,
    })
  }
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

export const WMS_IMPORT_FEATURES = [...WMS_INVENTORY_MUTATION_FEATURES, 'wms.import'] as const
