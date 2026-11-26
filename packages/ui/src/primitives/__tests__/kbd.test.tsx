/** @jest-environment jsdom */

import * as React from 'react'
import { render } from '@testing-library/react'

import { KbdShortcut, KbdSubmitShortcut, MOD_KEY, isApplePlatform } from '../kbd'

const originalPlatform = Object.getOwnPropertyDescriptor(window.navigator, 'platform')

function mockPlatform(platform: string) {
  Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true })
}

function renderedKeys(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('kbd')).map((node) => node.textContent ?? '')
}

describe('Kbd submit shortcut', () => {
  afterEach(() => {
    if (originalPlatform) Object.defineProperty(window.navigator, 'platform', originalPlatform)
  })

  it('renders Ctrl + Enter on Windows', () => {
    mockPlatform('Win32')
    const { container } = render(<KbdSubmitShortcut />)
    expect(renderedKeys(container)).toEqual(['Ctrl', 'Enter'])
    expect(container.textContent).not.toContain('⌘')
  })

  it('renders ⌘ + Enter on macOS', () => {
    mockPlatform('MacIntel')
    const { container } = render(<KbdSubmitShortcut />)
    expect(renderedKeys(container)).toEqual(['⌘', 'Enter'])
  })

  it('resolves the MOD_KEY token inside KbdShortcut and keeps literal keys untouched', () => {
    mockPlatform('Linux x86_64')
    const { container } = render(<KbdShortcut keys={[MOD_KEY, 'Shift', 'Enter']} />)
    expect(renderedKeys(container)).toEqual(['Ctrl', 'Shift', 'Enter'])
    const literal = render(<KbdShortcut keys={['⌘', 'K']} />)
    expect(renderedKeys(literal.container)).toEqual(['⌘', 'K'])
  })

  it('detects Apple platforms including iPad and iPhone', () => {
    mockPlatform('iPad')
    expect(isApplePlatform()).toBe(true)
    mockPlatform('iPhone')
    expect(isApplePlatform()).toBe(true)
    mockPlatform('Win32')
    expect(isApplePlatform()).toBe(false)
  })
})
