import * as React from 'react'
import * as fs from 'fs'
import * as path from 'path'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Popover, PopoverContent, PopoverTrigger } from '../popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select'
import { ComboboxInput } from '../../backend/inputs/ComboboxInput'

const Z_INDEX_BY_TOKEN: Record<string, number> = {
  'z-base': 0,
  'z-sticky': 10,
  'z-dropdown': 20,
  'z-overlay': 30,
  'z-modal': 40,
  'z-popover': 45,
  'z-toast': 50,
  'z-modal-elevated': 55,
  'z-tooltip': 60,
  'z-banner': 70,
  'z-top': 100,
}

function findZIndexToken(className: string | undefined): string | null {
  if (!className) return null
  const tokens = className.split(/\s+/)
  for (const token of tokens) {
    if (token in Z_INDEX_BY_TOKEN) return token
  }
  return null
}

describe('Issue #1836: portaled overlay primitives sit above modals (z-popover > z-modal)', () => {
  it('PopoverContent renders with z-popover so it is visible inside modals/drawers', async () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>open</PopoverTrigger>
        <PopoverContent data-testid="popover-content">
          <span>popover body</span>
        </PopoverContent>
      </Popover>,
    )

    const content = await screen.findByTestId('popover-content')
    const token = findZIndexToken(content.className)
    expect(token).toBe('z-popover')
    expect(Z_INDEX_BY_TOKEN[token!]).toBeGreaterThan(Z_INDEX_BY_TOKEN['z-modal'])
  })

  it('SelectContent renders with z-popover so dropdowns inside filter overlays are visible', () => {
    render(
      <Select defaultOpen>
        <SelectTrigger>
          <SelectValue placeholder="pick" />
        </SelectTrigger>
        <SelectContent data-testid="select-content">
          <SelectItem value="a">A</SelectItem>
          <SelectItem value="b">B</SelectItem>
        </SelectContent>
      </Select>,
    )

    const content = screen.getByTestId('select-content')
    const token = findZIndexToken(content.className)
    expect(token).toBe('z-popover')
    expect(Z_INDEX_BY_TOKEN[token!]).toBeGreaterThan(Z_INDEX_BY_TOKEN['z-modal'])
  })

  it('ComboboxInput suggestion list renders with z-popover when suggestions are open', () => {
    const { container } = render(
      <ComboboxInput
        value=""
        onChange={() => {}}
        suggestions={[{ value: 'alpha', label: 'Alpha' }]}
      />,
    )

    const input = container.querySelector('input')
    expect(input).not.toBeNull()
    act(() => {
      fireEvent.focus(input!)
    })
    act(() => {
      fireEvent.change(input!, { target: { value: 'a' } })
    })

    const suggestions = container.querySelector('[class*="z-popover"]')
    expect(suggestions).not.toBeNull()
    const token = findZIndexToken((suggestions as HTMLElement).className)
    expect(token).toBe('z-popover')
    expect(Z_INDEX_BY_TOKEN[token!]).toBeGreaterThan(Z_INDEX_BY_TOKEN['z-modal'])
  })

  it('z-index scale defines --z-index-popover (45) between modal (40) and toast (50) in both globals.css files', () => {
    const repoRoot = path.resolve(__dirname, '../../../../..')
    const cssPaths = [
      path.join(repoRoot, 'apps/mercato/src/app/globals.css'),
      path.join(repoRoot, 'packages/create-app/template/src/app/globals.css'),
    ]

    for (const cssPath of cssPaths) {
      const css = fs.readFileSync(cssPath, 'utf8')
      const popoverMatch = css.match(/--z-index-popover:\s*(\d+);/)
      const modalMatch = css.match(/--z-index-modal:\s*(\d+);/)
      const toastMatch = css.match(/--z-index-toast:\s*(\d+);/)

      expect(popoverMatch).not.toBeNull()
      expect(modalMatch).not.toBeNull()
      expect(toastMatch).not.toBeNull()

      const popoverZ = Number(popoverMatch![1])
      const modalZ = Number(modalMatch![1])
      const toastZ = Number(toastMatch![1])

      expect(popoverZ).toBeGreaterThan(modalZ)
      expect(popoverZ).toBeLessThan(toastZ)
    }
  })

  it('globals.css explicitly emits the z-popover utility used by portaled UI package overlays', () => {
    const repoRoot = path.resolve(__dirname, '../../../../..')
    const cssPaths = [
      path.join(repoRoot, 'apps/mercato/src/app/globals.css'),
      path.join(repoRoot, 'packages/create-app/template/src/app/globals.css'),
    ]

    for (const cssPath of cssPaths) {
      const css = fs.readFileSync(cssPath, 'utf8')

      expect(css).toContain('@utility z-popover')
      expect(css).toContain('z-index: var(--z-index-popover);')
    }
  })

  it('globals.css defines z-modal-elevated (55) above z-popover so dialogs opened from inside popovers are visible', () => {
    const repoRoot = path.resolve(__dirname, '../../../../..')
    const cssPaths = [
      path.join(repoRoot, 'apps/mercato/src/app/globals.css'),
      path.join(repoRoot, 'packages/create-app/template/src/app/globals.css'),
    ]

    for (const cssPath of cssPaths) {
      const css = fs.readFileSync(cssPath, 'utf8')

      expect(css).toContain('@utility z-modal-elevated')
      expect(css).toMatch(/z-index:\s*var\(--z-index-modal-elevated(?:,\s*\d+)?\);/)

      const elevatedMatch = css.match(/--z-index-modal-elevated:\s*(\d+);/)
      const popoverMatch = css.match(/--z-index-popover:\s*(\d+);/)
      expect(elevatedMatch).not.toBeNull()
      expect(popoverMatch).not.toBeNull()
      expect(Number(elevatedMatch![1])).toBeGreaterThan(Number(popoverMatch![1]))
    }
  })
})
