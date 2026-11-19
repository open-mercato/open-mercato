/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import en from '../../../../../../i18n/en.json'
import pl from '../../../../../../i18n/pl.json'
import de from '../../../../../../i18n/de.json'
import es from '../../../../../../i18n/es.json'
import ko from '../../../../../../i18n/ko.json'

type Dictionary = Record<string, string>
type Params = Record<string, string | number>

let activeDictionary: Dictionary = en

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, params?: Params) => {
    const template = activeDictionary[key]
    if (template === undefined) return key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    )
  },
}))

import { CloseDateFilterPopover } from '../CloseDateFilterPopover'

const CHIP_LABEL_KEY = 'customers.deals.kanban.filter.closeDate'
const CLOSE_BUTTON_KEY = 'customers.deals.kanban.filter.close'
const ANY_KEY = 'customers.deals.kanban.filter.any'

describe('CloseDateFilterPopover labels', () => {
  const locales: Array<[string, Dictionary]> = [
    ['en', en],
    ['pl', pl],
    ['de', de],
    ['es', es],
    ['ko', ko],
  ]

  it.each(locales)('%s: labels the chip with the close date and the X button with the close action', async (_locale, dictionary) => {
    activeDictionary = dictionary
    render(<CloseDateFilterPopover value={{ from: null, to: null }} onApply={jest.fn()} />)

    const chip = screen.getByRole('button', {
      name: `${dictionary[CHIP_LABEL_KEY]}: ${dictionary[ANY_KEY]}`,
    })
    fireEvent.click(chip)

    expect(await screen.findByRole('button', { name: dictionary[CLOSE_BUTTON_KEY] })).toBeInTheDocument()
  })

  it.each(locales.filter(([locale]) => locale !== 'en'))(
    '%s: keeps the close date noun apart from the close action verb',
    (_locale, dictionary) => {
      expect(dictionary[CHIP_LABEL_KEY]).not.toBe(dictionary[CLOSE_BUTTON_KEY])
    },
  )
})
