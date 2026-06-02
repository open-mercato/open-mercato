/** @jest-environment jsdom */

import * as React from 'react'
import { render } from '@testing-library/react'

import { Separator } from '../separator'

describe('Separator', () => {
  describe('horizontal (default)', () => {
    it('renders role="separator" with the bare-rule look (backward compat)', () => {
      const { container } = render(<Separator />)
      const sep = container.querySelector('[data-slot="separator"]') as HTMLElement
      expect(sep).not.toBeNull()
      expect(sep.getAttribute('role')).toBe('separator')
      expect(sep.getAttribute('aria-orientation')).toBe('horizontal')
      expect(sep.getAttribute('data-variant')).toBe('solid')
      expect(sep.className).toContain('h-px')
      expect(sep.className).toContain('w-full')
      expect(sep.className).toContain('bg-border')
    })

    it('forwards className', () => {
      const { container } = render(<Separator className="my-4 custom-class" />)
      const sep = container.querySelector('[data-slot="separator"]') as HTMLElement
      expect(sep.className).toContain('my-4')
      expect(sep.className).toContain('custom-class')
      // Default base classes still applied.
      expect(sep.className).toContain('bg-border')
    })
  })

  describe('vertical', () => {
    it('renders w-px h-full vertical rule', () => {
      const { container } = render(<Separator orientation="vertical" />)
      const sep = container.querySelector('[data-slot="separator"]') as HTMLElement
      expect(sep.getAttribute('aria-orientation')).toBe('vertical')
      expect(sep.className).toContain('h-full')
      expect(sep.className).toContain('w-px')
      expect(sep.className).toContain('bg-border')
    })

    it('vertical + dashed switches to border-l-dashed', () => {
      const { container } = render(
        <Separator orientation="vertical" variant="dashed" />,
      )
      const sep = container.querySelector('[data-slot="separator"]') as HTMLElement
      expect(sep.className).toContain('border-l')
      expect(sep.className).toContain('border-dashed')
      expect(sep.className).not.toContain('bg-border')
    })
  })

  describe('variant="dashed"', () => {
    it('renders horizontal dashed rule with border-t border-dashed', () => {
      const { container } = render(<Separator variant="dashed" />)
      const sep = container.querySelector('[data-slot="separator"]') as HTMLElement
      expect(sep.getAttribute('data-variant')).toBe('dashed')
      expect(sep.className).toContain('border-t')
      expect(sep.className).toContain('border-dashed')
      expect(sep.className).toContain('h-0')
      expect(sep.className).not.toContain('bg-border')
    })
  })

  describe('label (inline label between two rule halves)', () => {
    it('renders the label slot with two rule segments by default', () => {
      const { container } = render(<Separator label="OR" />)
      const sep = container.querySelector('[data-slot="separator"]') as HTMLElement
      expect(sep.getAttribute('data-label-align')).toBe('center')
      const label = container.querySelector('[data-slot="separator-label"]') as HTMLElement
      expect(label).not.toBeNull()
      expect(label.textContent).toBe('OR')
      const rules = container.querySelectorAll('[data-slot="separator-rule"]')
      expect(rules.length).toBe(2)
    })

    it('start-aligned label has a short left segment + flex-1 right segment', () => {
      const { container } = render(<Separator label="Section" labelAlign="start" />)
      const sep = container.querySelector('[data-slot="separator"]') as HTMLElement
      expect(sep.getAttribute('data-label-align')).toBe('start')
      const rules = Array.from(
        container.querySelectorAll('[data-slot="separator-rule"]'),
      ) as HTMLElement[]
      expect(rules.length).toBe(2)
      // First segment is the short stub (w-6), second is flex-1.
      expect(rules[0].className).toContain('w-6')
      expect(rules[1].className).toContain('flex-1')
    })

    it('end-aligned label has flex-1 left segment + short right segment', () => {
      const { container } = render(<Separator label="Section" labelAlign="end" />)
      const rules = Array.from(
        container.querySelectorAll('[data-slot="separator-rule"]'),
      ) as HTMLElement[]
      expect(rules[0].className).toContain('flex-1')
      expect(rules[1].className).toContain('w-6')
    })

    it('label + dashed variant flows through to both rule segments', () => {
      const { container } = render(<Separator label="OR" variant="dashed" />)
      const rules = Array.from(
        container.querySelectorAll('[data-slot="separator-rule"]'),
      ) as HTMLElement[]
      expect(rules.length).toBe(2)
      for (const rule of rules) {
        expect(rule.className).toContain('border-dashed')
        expect(rule.className).toContain('border-t')
      }
    })
  })

  describe('section variant', () => {
    it('renders a full-width bg-muted strip with uppercase label', () => {
      const { container } = render(
        <Separator section label="AMOUNT & ACCOUNT" />,
      )
      const sep = container.querySelector('[data-slot="separator"]') as HTMLElement
      expect(sep.getAttribute('data-variant')).toBe('section')
      expect(sep.className).toContain('bg-muted')
      expect(sep.className).toContain('uppercase')
      expect(sep.textContent).toBe('AMOUNT & ACCOUNT')
    })

    it('section variant accepts children when label is omitted', () => {
      const { container } = render(
        <Separator section>
          <span data-testid="custom">Custom JSX</span>
        </Separator>,
      )
      const sep = container.querySelector('[data-slot="separator"]') as HTMLElement
      expect(sep.querySelector('[data-testid="custom"]')).not.toBeNull()
    })

    it('section variant forwards className', () => {
      const { container } = render(
        <Separator section label="X" className="mt-4 custom" />,
      )
      const sep = container.querySelector('[data-slot="separator"]') as HTMLElement
      expect(sep.className).toContain('mt-4')
      expect(sep.className).toContain('custom')
    })
  })
})
