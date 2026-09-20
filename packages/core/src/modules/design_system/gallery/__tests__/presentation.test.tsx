/** @jest-environment jsdom */
import * as React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { assetBrowserEntryIds, fullWidthEntryIds, representativeVariantIds } from '../presentation'
import { getCompactEntrySpecimen } from '../components/CompactEntrySpecimen'

type Inventory = { items: Array<{ entryId: string; variantIds: string[] }> }

test('presentation choices reference existing entries and real registered variants', () => {
  const inventory: Inventory = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../../../packages/create-app/scripts/design-system/design-system-inventory.json'), 'utf8'))
  const entries = new Map(inventory.items.map(entry => [entry.entryId, entry]))
  for (const entryId of fullWidthEntryIds) expect(entries.has(entryId)).toBe(true)
  for (const entryId of assetBrowserEntryIds) expect(fullWidthEntryIds.has(entryId)).toBe(true)
  for (const [entryId, variantId] of Object.entries(representativeVariantIds)) expect(entries.get(entryId)?.variantIds).toContain(variantId)
})

function showSpecimen(entryId: string) {
  return render(<I18nProvider locale="en" dict={{}}>{getCompactEntrySpecimen(entryId)}</I18nProvider>)
}

test('compact button specimen shows four locally toggled controls instead of the full matrix', () => {
  showSpecimen('compact-button')
  const buttons = screen.getAllByRole('button')
  expect(buttons).toHaveLength(4)
  expect(buttons[0]).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(buttons[0])
  expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')
})

test('key icon specimen shows five examples instead of the 45-icon palette', () => {
  showSpecimen('key-icon')
  expect(screen.getAllByRole('img')).toHaveLength(5)
})

test('illustration specimen shows one real artwork instead of the complete collection', () => {
  const view = showSpecimen('empty-state-illustration')
  expect(view.container.querySelectorAll('img')).toHaveLength(1)
  expect(view.container.querySelector('img')).toHaveAttribute('src')
})

test('banner specimen can be dismissed and restored locally', () => {
  showSpecimen('banner')
  expect(screen.getAllByRole('status')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss banner' }))
  expect(screen.queryByRole('status')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'design_system.gallery.samples.banner.restore' }))
  expect(screen.getAllByRole('status')).toHaveLength(1)
})
