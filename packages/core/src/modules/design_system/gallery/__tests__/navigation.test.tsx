/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { GalleryNavigation } from '../components/GalleryNavigation'
import polish from '../../i18n/pl.json'

jest.mock('@open-mercato/ui/backend/injection/useInjectedMenuItems', () => ({ useInjectedMenuItems: () => ({ items: [] }) }))

const sections = [{ id: 'families', label: 'Components', items: [
  { id: 'buttons', label: 'Przyciski', href: '/backend/design-system?family=buttons', children: [{ id: 'button', label: 'Button', href: '/backend/design-system?family=buttons&entry=button' }] },
  { id: 'inputs', label: 'Pola formularza', href: '/backend/design-system?family=inputs', children: [{ id: 'input', label: 'Input', href: '/backend/design-system?family=inputs&entry=input' }] },
] }]

it('keeps other categories reachable, expands the current category, and marks its current component', () => {
  const onExpand = jest.fn()
  const onNavigate = jest.fn()
  render(<I18nProvider locale="pl" dict={polish}><GalleryNavigation sections={sections} activePath="/backend/design-system?family=buttons&entry=button" activeFamilyId="buttons" onExpand={onExpand} onNavigate={onNavigate} failed={{}} onRetry={jest.fn()} /></I18nProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Przeglądaj bibliotekę' }))
  const nav = screen.getByRole('navigation', { name: 'Nawigacja systemu projektowego' })
  expect(within(nav).getByRole('link', { name: 'Button', exact: true })).toHaveAttribute('aria-current', 'page')
  expect(within(nav).getByRole('link', { name: 'Pola formularza' })).toHaveAttribute('href', '/backend/design-system?family=inputs')
  expect(within(nav).queryByRole('link', { name: 'Input', exact: true })).toBeNull()
  fireEvent.click(within(nav).getByRole('button', { name: 'Rozwiń: Pola formularza' }))
  expect(onExpand).toHaveBeenCalledWith('inputs')
  expect(onNavigate).not.toHaveBeenCalled()
  expect(within(nav).getByRole('link', { name: 'Input', exact: true })).toBeVisible()
  fireEvent.click(within(nav).getByRole('link', { name: 'Input', exact: true }))
  expect(onNavigate).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Przeglądaj bibliotekę' })).toHaveAttribute('aria-expanded', 'false')
})
