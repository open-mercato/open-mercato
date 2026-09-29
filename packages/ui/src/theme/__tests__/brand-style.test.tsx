import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { BrandStyleRuntime } from '../BrandStyleRuntime'
import { useBrandStyle } from '../useBrandStyle'
import { BRAND_STYLE_ELEMENT_ID, BRAND_STYLE_STORAGE_KEY, getBrandStyle, saveBrandStyle, type BrandStyle } from '../brand-style'

const sample: BrandStyle = {
  version: 1,
  logo: 'data:image/png;base64,aGVsbG8=',
  light: { '--primary': '#124488', '--primary-hover': '#113366', '--primary-foreground': '#FFFFFF' },
  dark: { '--primary': '#AACCFF', '--primary-hover': '#88AADD', '--primary-foreground': '#000000' },
}

function Consumer() {
  const style = useBrandStyle()
  return <span data-testid="logo">{style?.logo ?? 'default'}</span>
}

beforeEach(() => { window.localStorage.clear() })
afterEach(() => { jest.restoreAllMocks() })

it('applies both theme rules, updates subscribers and restores untouched defaults', () => {
  document.documentElement.style.setProperty('--primary', '#123456')
  const view = render(<><BrandStyleRuntime /><Consumer /></>)
  expect(document.getElementById(BRAND_STYLE_ELEMENT_ID)).toBeNull()
  act(() => saveBrandStyle(sample))
  expect(screen.getByTestId('logo').textContent).toBe(sample.logo)
  const rules = document.getElementById(BRAND_STYLE_ELEMENT_ID)?.textContent
  expect(rules).toContain(':root:not(.dark){--primary:#124488;')
  expect(rules).toContain(':root.dark{--primary:#AACCFF;')
  expect(rules).not.toContain('--status-')
  expect(rules).not.toContain('--accent-indigo')
  act(() => saveBrandStyle(null))
  expect(document.getElementById(BRAND_STYLE_ELEMENT_ID)).toBeNull()
  expect(screen.getByTestId('logo').textContent).toBe('default')
  expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#123456')
  document.documentElement.style.removeProperty('--primary')
  view.unmount()
})

it('hydrates a saved style and cleans up its owned stylesheet on unmount', () => {
  saveBrandStyle(sample)
  const view = render(<BrandStyleRuntime />)
  expect(document.getElementById(BRAND_STYLE_ELEMENT_ID)).not.toBeNull()
  view.unmount()
  expect(document.getElementById(BRAND_STYLE_ELEMENT_ID)).toBeNull()
  expect(getBrandStyle()).toEqual(sample)
})

it('responds to cross-tab changes and storage clearing', () => {
  render(<Consumer />)
  act(() => {
    window.localStorage.setItem(BRAND_STYLE_STORAGE_KEY, JSON.stringify(sample))
    window.dispatchEvent(new StorageEvent('storage', { key: BRAND_STYLE_STORAGE_KEY }))
  })
  expect(screen.getByTestId('logo').textContent).toBe(sample.logo)
  act(() => {
    window.localStorage.clear()
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
  })
  expect(screen.getByTestId('logo').textContent).toBe('default')
})

it.each([
  { ...sample, light: { ...sample.light, '--status-error-bg': '#000000' } },
  { ...sample, dark: { ...sample.dark, '--primary': 'red;display:none' } },
  { ...sample, light: { ...sample.light, '--primary-foreground': '#BBBBBB', '--primary': '#CCCCCC' } },
  { ...sample, light: { ...sample.light, '--primary-hover': '#FFFFFF' } },
  { ...sample, light: { ...sample.light, '--brand-lime': '#FFFFFF', '--brand-violet': '#000000', '--brand-violet-foreground': '#FFFFFF' } },
  { ...sample, logo: 'https://example.com/logo.png' },
  { ...sample, logo: 'data:image/svg+xml;base64,aGVsbG8=' },
  { ...sample, logo: `data:image/png;base64,${'a'.repeat(1_400_000)}` },
])('rejects unsupported or unreadable overrides without changing the applied profile', invalid => {
  saveBrandStyle(sample)
  expect(() => saveBrandStyle(invalid as BrandStyle)).toThrow()
  expect(getBrandStyle()).toEqual(sample)
})

it.each(['{oops', '{"version":9}', 'null', '[]'])('ignores malformed saved settings: %s', raw => {
  window.localStorage.setItem(BRAND_STYLE_STORAGE_KEY, raw)
  expect(getBrandStyle()).toBeNull()
})

it('keeps the prior style if storage is unavailable and does not emit a success change', () => {
  saveBrandStyle(sample)
  const listener = jest.fn()
  window.addEventListener('om-brand-style-change', listener)
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  expect(() => saveBrandStyle({ ...sample, logo: null })).toThrow('quota')
  expect(getBrandStyle()).toEqual(sample)
  expect(listener).not.toHaveBeenCalled()
  window.removeEventListener('om-brand-style-change', listener)
})
