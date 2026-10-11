/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import english from '../../i18n/en.json'
import polish from '../../i18n/pl.json'
import german from '../../i18n/de.json'
import spanish from '../../i18n/es.json'
import korean from '../../i18n/ko.json'
import { galleryFamilies } from '../registry'
import { EntryCard } from '../components/EntryCard'

const dictionaries: Record<string, Record<string, string>> = { en: english, pl: polish, de: german, es: spanish, ko: korean }

it('has localized variant captions and usage for every registered entry', async () => {
  const missing: string[] = []
  for (const family of galleryFamilies) {
    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      if (!dictionary[family.labelKey]?.trim()) missing.push(`${locale}: ${family.labelKey}`)
    }
    for (const entry of (await family.load()).entries) {
      for (const [locale, dictionary] of Object.entries(dictionaries)) {
        for (const variant of entry.variants) {
          const key = `design_system.gallery.variantTitles.${variant.title}`
          if (!dictionary[key]?.trim()) missing.push(`${locale}: ${key}`)
        }
        for (const kind of ['do', 'dont'] as const) {
          entry.usage?.[kind]?.forEach((_, index) => {
            const key = `design_system.gallery.usage.${entry.id}.${kind}.${index}`
            if (!dictionary[key]?.trim()) missing.push(`${locale}: ${key}`)
          })
        }
      }
    }
  }
  expect([...new Set(missing)]).toEqual([])
})

it('shows Polish Button captions and actions for all variants without translating code or component names', async () => {
  const entry = (await galleryFamilies.find(family => family.id === 'buttons')!.load()).entries.find(entry => entry.id === 'button')!
  render(<I18nProvider locale="pl" dict={polish}><EntryCard entry={entry} /></I18nProvider>)
  expect(screen.getByRole('heading', { name: 'Button' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Domyślny' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Rozmiary' })).toBeVisible()
  expect(screen.getAllByRole('button', { name: 'Zapisz zmiany' }).length).toBeGreaterThan(0)
  expect(screen.getByRole('button', { name: 'Anuluj' })).toBeVisible()
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(entry.variants.find(variant => variant.id === 'default')!.code).toContain('@open-mercato/ui/primitives/button')
})
