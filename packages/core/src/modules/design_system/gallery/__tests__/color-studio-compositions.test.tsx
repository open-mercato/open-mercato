/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import english from '../../i18n/en.json'
import { ColorStudioCompositions } from '../components/ColorStudioCompositions'
import { createColorStudio } from '../components/colorStudio'

const studio = createColorStudio('#F4700D')
function content(color = studio, theme: 'light' | 'dark' = 'light') {
  return <I18nProvider locale="en" dict={english}><ColorStudioCompositions theme={theme} tokens={color[theme].tokens} /></I18nProvider>
}

it('renders eight balanced compositions with real local images and container-responsive layout', () => {
  const view = render(content())
  expect(screen.getAllByRole('article')).toHaveLength(8)
  expect(screen.getByAltText('Portrait of a smiling creative professional')).toBeVisible()
  expect(screen.getByAltText('Light gray Atlas Runner sneaker')).toBeVisible()
  expect(screen.getByAltText('Designer working on a laptop')).toBeVisible()
  expect(view.container.querySelector('.auto-rows-fr')).toHaveClass('@md/cards:grid-cols-2', '@7xl/cards:grid-cols-4')
  for (const card of screen.getAllByRole('article')) expect(card).toHaveClass('min-h-112')
  for (const image of view.container.querySelectorAll('img')) expect(image.src).not.toMatch(/^https:\/\//)
})

it('changes plans and creative categories with meaningful selected content', () => {
  render(content())
  const plans = screen.getByRole('article', { name: 'Choose your creative space' })
  const team = within(plans).getByRole('button', { name: /Studio/ })
  fireEvent.click(team)
  expect(team).toHaveAttribute('aria-pressed', 'true')
  expect(within(plans).getByRole('status')).toHaveTextContent('Create together with your team')
  expect(within(plans).getByRole('button', { name: /Solo/ })).toHaveAttribute('aria-pressed', 'false')
  const categories = screen.getByRole('article', { name: 'Find your direction' })
  fireEvent.click(within(categories).getByRole('button', { name: 'Digital' }))
  expect(within(categories).getByRole('status')).toHaveTextContent('Interfaces that feel natural')
  fireEvent.click(within(categories).getByRole('button', { name: 'Editorial' }))
  expect(within(categories).getByRole('status')).toHaveTextContent('Stories worth slowing down for')
})

it('completes tasks and toggles saves and follows without navigating away', () => {
  render(content())
  const tasks = screen.getByRole('article', { name: 'One idea at a time' })
  fireEvent.click(within(tasks).getByRole('checkbox', { name: 'Explore the color palette' }))
  fireEvent.click(within(tasks).getByRole('checkbox', { name: 'Prepare the final concept' }))
  expect(within(tasks).getByRole('status')).toHaveTextContent('Everything is ready')
  fireEvent.click(within(tasks).getByRole('checkbox', { name: 'Collect references' }))
  expect(within(tasks).getByRole('status')).toHaveTextContent('Good things take a little focus')
  fireEvent.click(screen.getByRole('button', { name: 'Save product to collection' }))
  expect(screen.getByRole('button', { name: 'Remove product from collection' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('Saved to your collection')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Save inspiration' }))
  expect(screen.getByRole('button', { name: 'Inspiration saved' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Follow creator' }))
  expect(screen.getByRole('button', { name: 'Unfollow creator' })).toHaveAttribute('aria-pressed', 'true')
})

it('reacts to all three palette colors and keeps photo captions on readable solid surfaces', () => {
  const view = render(content())
  const poster = screen.getByRole('article', { name: 'Creative poster' })
  const before = poster.getAttribute('style')
  const changed = createColorStudio('#2563EB', 'neutral', {}, { secondary: '#00D66E', tertiary: '#8A48E7' })
  view.rerender(content(changed))
  expect(poster.getAttribute('style')).not.toBe(before)
  const creator = screen.getByRole('article', { name: 'Meet the maker' })
  const footer = within(creator).getByRole('heading', { name: 'Maya Kim' }).parentElement
  expect(footer).toHaveStyle({ backgroundColor: changed.light.tokens['--primary'], color: changed.light.tokens['--primary-foreground'] })
  const inspiration = screen.getByRole('article', { name: 'Inspiration board' })
  expect(within(inspiration).getByRole('heading').parentElement).toHaveStyle({ backgroundColor: changed.light.tokens['--studio-tertiary'], color: changed.light.tokens['--studio-tertiary-foreground'] })
  view.rerender(content(changed, 'dark'))
  expect(footer).toHaveStyle({ backgroundColor: changed.dark.tokens['--primary'], color: changed.dark.tokens['--primary-foreground'] })
})
