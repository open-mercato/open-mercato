/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import en from '../../../../../../apps/mercato/src/i18n/en.json'
import pl from '../../../../../../apps/mercato/src/i18n/pl.json'
import es from '../../../../../../apps/mercato/src/i18n/es.json'
import { LookupSelect } from '../LookupSelect'

describe('LookupSelect minimum-query guidance', () => {
  it('shows generic guidance instead of a zero-character minimum when opened or cleared', () => {
    render(
      <I18nProvider locale="en" dict={en}>
        <LookupSelect value={null} onChange={jest.fn()} minQuery={0} defaultOpen options={[]} />
      </I18nProvider>,
    )

    expect(screen.getByText('Start typing to search.')).toBeInTheDocument()
    expect(screen.queryByText(/Minimum characters/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'missing' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })

    expect(screen.getByText('Start typing to search.')).toBeInTheDocument()
    expect(screen.queryByText(/Minimum characters/)).not.toBeInTheDocument()
  })

  it.each([
    ['en', en, 'Minimum characters to search: 1. You can also paste an id.'],
    ['pl', pl, 'Minimalna liczba znaków do wyszukiwania: 1. Możesz też wkleić identyfikator.'],
    ['es', es, 'Caracteres mínimos para buscar: 1. También puedes pegar un id.'],
  ] as const)('uses grammatical one-character guidance in %s', (locale, dict, hint) => {
    render(
      <I18nProvider locale={locale} dict={dict}>
        <LookupSelect value={null} onChange={jest.fn()} minQuery={1} defaultOpen options={[]} />
      </I18nProvider>,
    )

    expect(screen.getByText(hint)).toBeInTheDocument()
  })

  it('keeps positive-minimum guidance and custom hint overrides', () => {
    const { rerender } = render(
      <I18nProvider locale="en" dict={en}>
        <LookupSelect value={null} onChange={jest.fn()} minQuery={2} options={[]} />
      </I18nProvider>,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a' } })
    expect(screen.getByText('Minimum characters to search: 2. You can also paste an id.')).toBeInTheDocument()

    rerender(
      <I18nProvider locale="en" dict={en}>
        <LookupSelect value={null} onChange={jest.fn()} minQuery={2} options={[]} minQueryHintLabel="Custom guidance" />
      </I18nProvider>,
    )
    expect(screen.getByText('Custom guidance')).toBeInTheDocument()
  })

  it('still loads and selects results without a minimum query', async () => {
    const fetchItems = jest.fn(async () => [{ id: 'variant', title: 'Available variant' }])
    const onChange = jest.fn()
    render(
      <I18nProvider locale="en" dict={en}>
        <LookupSelect value={null} onChange={onChange} minQuery={0} defaultOpen fetchItems={fetchItems} />
      </I18nProvider>,
    )

    fireEvent.click(await screen.findByRole('option', { name: /Available variant/ }))
    expect(fetchItems).toHaveBeenCalledWith('')
    expect(onChange).toHaveBeenCalledWith('variant')
  })
})
