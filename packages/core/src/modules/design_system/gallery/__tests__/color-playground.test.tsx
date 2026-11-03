/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import english from '../../i18n/en.json'
import { ColorPlayground } from '../components/ColorPlayground'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/backend/design-system',
}))

jest.mock('../components/themeTokens', () => ({
  readThemeTokens: () => ({
    light: { '--background': '#FFFFFF', '--foreground': '#171717', '--status-success-text': '#14532D' },
    dark: { '--background': '#171717', '--foreground': '#FFFFFF', '--status-success-text': '#86EFAC' },
  }),
}))

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  HTMLElement.prototype.scrollIntoView = jest.fn()
  HTMLElement.prototype.hasPointerCapture = jest.fn()
  HTMLElement.prototype.releasePointerCapture = jest.fn()
})

async function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => { render(<QueryClientProvider client={client}><I18nProvider locale="en" dict={english}><ColorPlayground /></I18nProvider></QueryClientProvider>) })
  return {
    light: screen.getByRole('region', { name: 'Interface preview — Light', exact: true }),
    dark: screen.getByRole('region', { name: 'Interface preview — Dark', exact: true }),
    hex: screen.getByRole('textbox', { name: 'HEX color', exact: true }),
  }
}

async function choose(label: string, option: string | RegExp) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label, exact: true }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

function tokenValues(element: HTMLElement) {
  return Object.fromEntries(Array.from(element.style).map(token => [token, element.style.getPropertyValue(token)]))
}

function mockClipboard() {
  const writeText = jest.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  return writeText
}

it('updates both local theme previews while preserving their semantic statuses and the host', async () => {
  const rootBefore = document.documentElement.outerHTML.split('<head>')[0]
  const { light, dark, hex } = await setup()
  const originalLight = light.style.getPropertyValue('--primary')
  const originalDark = dark.style.getPropertyValue('--primary')
  fireEvent.change(hex, { target: { value: '#2563eb' } })
  expect(light.style.getPropertyValue('--primary')).not.toBe(originalLight)
  expect(dark.style.getPropertyValue('--primary')).not.toBe(originalDark)
  expect(light.style.getPropertyValue('--status-success-text')).toBe('#14532D')
  expect(dark.style.getPropertyValue('--status-success-text')).toBe('#86EFAC')
  expect(within(light).getAllByText('Confirmed')[0]).toHaveClass('text-status-success-text')
  expect(document.documentElement.outerHTML.split('<head>')[0]).toBe(rootBefore)
})

it('starts in comparison and offers isolated single-theme views', async () => {
  const rootClass = document.documentElement.className
  await setup()
  expect(screen.getByRole('radio', { name: 'Compare', exact: true })).toBeChecked()
  await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Dark', exact: true })) })
  expect(screen.queryByRole('region', { name: 'Interface preview — Light', exact: true })).toBeNull()
  expect(screen.getByRole('region', { name: 'Interface preview — Dark', exact: true })).toHaveAttribute('data-preview-theme', 'dark')
  await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Light', exact: true })) })
  expect(screen.queryByRole('region', { name: 'Interface preview — Dark', exact: true })).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Compare', exact: true })) })
  expect(screen.getByRole('region', { name: 'Interface preview — Light', exact: true })).toBeVisible()
  expect(screen.getByRole('region', { name: 'Interface preview — Dark', exact: true })).toBeVisible()
  expect(document.documentElement.className).toBe(rootClass)
})

it('keeps the last valid colors on invalid input and resets the complete configuration', async () => {
  const { light, dark, hex } = await setup()
  const initialLight = tokenValues(light)
  const initialDark = tokenValues(dark)
  const initialSecondary = (screen.getByRole('textbox', { name: 'Secondary HEX' }) as HTMLInputElement).value
  fireEvent.change(hex, { target: { value: '#FFFFFF' } })
  const validStyle = light.getAttribute('style')
  fireEvent.change(hex, { target: { value: 'oops' } })
  expect(screen.getByRole('alert')).toBeVisible()
  expect(hex).toHaveAttribute('aria-invalid', 'true')
  expect(light.getAttribute('style')).toBe(validStyle)
  fireEvent.change(screen.getByRole('textbox', { name: 'Secondary HEX' }), { target: { value: '#00FFAA' } })
  await choose('Neutral palette', 'Warm')
  await choose('Light theme action', /^800 ·/)
  await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Dark', exact: true })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reset', exact: true })) })
  expect(hex).toHaveValue('#F4700D')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('radio', { name: 'Compare', exact: true })).toBeChecked()
  expect(screen.getByRole('textbox', { name: 'Secondary HEX' })).toHaveValue(initialSecondary)
  expect(tokenValues(screen.getByRole('region', { name: 'Interface preview — Light', exact: true }))).toEqual(initialLight)
  expect(tokenValues(screen.getByRole('region', { name: 'Interface preview — Dark', exact: true }))).toEqual(initialDark)
})

it('changes neutral surfaces independently and assigns action shades per theme', async () => {
  const { light, dark } = await setup()
  const originalBackground = light.style.getPropertyValue('--background')
  const originalAction = light.style.getPropertyValue('--primary')
  await choose('Neutral palette', 'Cool')
  expect(light.style.getPropertyValue('--background')).not.toBe(originalBackground)
  expect(light.style.getPropertyValue('--primary')).toBe(originalAction)
  const originalDark = dark.style.getPropertyValue('--primary')
  await choose('Light theme action', /^800 ·/)
  expect(light.style.getPropertyValue('--primary')).not.toBe(originalAction)
  expect(dark.style.getPropertyValue('--primary')).toBe(originalDark)
})

it('derives harmonies, accepts supporting colors and restores automatic colors', async () => {
  const { light, hex } = await setup()
  const secondary = screen.getByRole('textbox', { name: 'Secondary HEX' }) as HTMLInputElement
  const tertiary = screen.getByRole('textbox', { name: 'Tertiary HEX' }) as HTMLInputElement
  const initialSecondary = secondary.value
  expect(screen.queryByRole('button', { name: 'Restore automatic colors' })).toBeNull()
  expect(screen.getByText(english['design_system.colorStudio.harmonyAutomatic'])).toBeVisible()
  await choose('Color harmony', 'Analogous')
  expect(secondary.value).not.toBe(initialSecondary)
  expect(screen.getByText(english['design_system.colorStudio.harmonyDescription.analogous'])).toBeVisible()
  fireEvent.change(hex, { target: { value: '#2563EB' } })
  const generatedSecondary = secondary.value
  const generatedTertiary = tertiary.value
  fireEvent.change(secondary, { target: { value: '#123456' } })
  const manualTokens = light.getAttribute('style')
  fireEvent.change(secondary, { target: { value: 'invalid' } })
  expect(secondary).toHaveAttribute('aria-invalid', 'true')
  expect(light.getAttribute('style')).toBe(manualTokens)
  fireEvent.change(secondary, { target: { value: '#123456' } })
  fireEvent.change(tertiary, { target: { value: '#AA3366' } })
  expect(screen.getByText(english['design_system.colorStudio.harmonyManual'])).toBeVisible()
  fireEvent.change(hex, { target: { value: '#F4700D' } })
  expect(secondary).toHaveValue('#123456')
  expect(tertiary).toHaveValue('#AA3366')
  fireEvent.change(hex, { target: { value: '#2563EB' } })
  fireEvent.click(screen.getByRole('button', { name: 'Restore automatic colors' }))
  expect(secondary).toHaveValue(generatedSecondary)
  expect(tertiary).toHaveValue(generatedTertiary)
  expect(hex).toHaveValue('#2563EB')
  expect(screen.getByText(english['design_system.colorStudio.harmonyRestored'])).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Restore automatic colors' })).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('exports all palettes and both theme mappings without exporting inherited status tokens', async () => {
  const writeText = mockClipboard()
  const { light, dark } = await setup()
  fireEvent.change(screen.getByRole('textbox', { name: 'Secondary HEX' }), { target: { value: '#123456' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Tertiary HEX' }), { target: { value: '#AA3366' } })
  fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' }))
  await waitFor(() => expect(screen.getByText('Palette copied')).toBeVisible())
  const copied = JSON.parse(writeText.mock.calls[0][0])
  expect(copied.seeds).toEqual({ primary: '#F4700D', secondary: '#123456', tertiary: '#AA3366' })
  expect(Object.keys(copied.scales)).toEqual(['accent', 'secondary', 'tertiary', 'neutral'])
  expect(Object.values(copied.scales.secondary)).toContain('#123456')
  expect(Object.values(copied.scales.tertiary)).toContain('#AA3366')
  expect(copied.themes.light['--primary']).toBe(light.style.getPropertyValue('--primary'))
  expect(copied.themes.dark['--primary']).toBe(dark.style.getPropertyValue('--primary'))
  expect(writeText.mock.calls[0][0]).not.toContain('--status-')
  fireEvent.click(screen.getByRole('button', { name: 'Copy CSS' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
  expect(writeText.mock.calls[1][0]).toContain('.ds-color-preview-light {')
  expect(writeText.mock.calls[1][0]).toContain('.ds-color-preview-dark {')
  expect(writeText.mock.calls[1][0]).toContain('--palette-secondary-')
  expect(writeText.mock.calls[1][0]).toContain('--palette-tertiary-')
})

it('reports clipboard failure without changing the preview', async () => {
  const writeText = mockClipboard().mockRejectedValue(new Error('Clipboard unavailable'))
  const { light } = await setup()
  const initialStyle = light.getAttribute('style')
  fireEvent.click(screen.getByRole('button', { name: 'Copy CSS' }))
  await waitFor(() => expect(screen.getByText('Could not copy the palette.')).toBeVisible())
  expect(writeText).toHaveBeenCalledTimes(1)
  expect(light.getAttribute('style')).toBe(initialStyle)
})

it.each([
  ['Move right: Primary', ['#00D66E', '#F4700D', '#8A48E7']],
  ['Move left: Secondary', ['#00D66E', '#F4700D', '#8A48E7']],
  ['Move right: Secondary', ['#F4700D', '#8A48E7', '#00D66E']],
  ['Move left: Tertiary', ['#F4700D', '#8A48E7', '#00D66E']],
])('swaps immediately with %s and reverses without losing seeds', async (label, expected) => {
  const { hex } = await setup()
  const secondary = screen.getByRole('textbox', { name: 'Secondary HEX' })
  const tertiary = screen.getByRole('textbox', { name: 'Tertiary HEX' })
  fireEvent.change(secondary, { target: { value: '#00D66E' } })
  fireEvent.change(tertiary, { target: { value: '#8A48E7' } })
  fireEvent.click(screen.getByRole('button', { name: label, exact: true }))
  ;[hex, secondary, tertiary].forEach((input, index) => expect(input).toHaveValue(expected[index]))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: label, exact: true }))
  ;[hex, secondary, tertiary].forEach((input, index) => expect(input).toHaveValue(['#F4700D', '#00D66E', '#8A48E7'][index]))
})

it('disables outer arrows and guards incomplete drafts', async () => {
  const { hex } = await setup()
  expect(screen.getByRole('button', { name: 'Move left: Primary' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Move right: Tertiary' })).toBeDisabled()
  fireEvent.change(hex, { target: { value: '#12' } })
  for (const button of screen.getAllByRole('button', { name: /^Move (left|right):/ })) expect(button).toBeDisabled()
  expect(hex).toHaveValue('#12')
})

it('drags a color directly to a non-adjacent role', async () => {
  const { hex } = await setup()
  const tertiary = screen.getByRole('textbox', { name: 'Tertiary HEX' })
  fireEvent.change(tertiary, { target: { value: '#8A48E7' } })
  const origin = hex.closest('[data-color-role]')!
  const destination = tertiary.closest('[data-color-role]')!
  const dataTransfer = { setData: jest.fn(), effectAllowed: '', dropEffect: '' }
  fireEvent.dragStart(origin.querySelector('[draggable]')!, { dataTransfer })
  fireEvent.dragOver(destination, { dataTransfer })
  fireEvent.drop(destination, { dataTransfer })
  expect(hex).toHaveValue('#8A48E7')
  expect(tertiary).toHaveValue('#F4700D')
})
