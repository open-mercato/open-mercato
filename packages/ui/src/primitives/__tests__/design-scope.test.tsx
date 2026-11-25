/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen } from '@testing-library/react'

import { DesignScope, designScopeRadiusStyle, useDesignScope } from '../design-scope'

function Probe() {
  const scope = useDesignScope()
  return <output data-testid="probe">{`${scope.mode ?? 'page'}|${scope.density}|${scope.shape}|${scope.dir ?? 'page'}`}</output>
}

describe('DesignScope', () => {
  it('sets the mode class, density, direction and shape radius on its element', () => {
    render(
      <DesignScope mode="dark" density="compact" shape="round" dir="rtl" data-testid="scope">
        <Probe />
      </DesignScope>,
    )
    const scope = screen.getByTestId('scope')
    expect(scope).toHaveClass('dark', 'bg-background', 'text-foreground')
    expect(scope).toHaveAttribute('data-density', 'compact')
    expect(scope).toHaveAttribute('dir', 'rtl')
    expect(scope.style.getPropertyValue('--om-radius-button')).toBe('9999px')
    expect(screen.getByTestId('probe')).toHaveTextContent('dark|compact|round|rtl')
  })

  it('inherits from the closest parent scope and lets children override', () => {
    render(
      <DesignScope density="compact" shape="sharp">
        <DesignScope mode="light" data-testid="inner">
          <Probe />
        </DesignScope>
      </DesignScope>,
    )
    expect(screen.getByTestId('probe')).toHaveTextContent('light|compact|sharp|page')
    const inner = screen.getByTestId('inner')
    expect(inner).not.toHaveAttribute('data-density')
    expect(inner.getAttribute('style')).toBeNull()
  })

  it('reports the defaults outside any scope', () => {
    render(<Probe />)
    expect(screen.getByTestId('probe')).toHaveTextContent('page|default|default|page')
  })

  it('accepts radius overrides and ignores unsafe values', () => {
    expect(designScopeRadiusStyle('default', { card: '20px', field: 'calc(1px)', badge: 'url(x)' })).toEqual({ '--om-radius-card': '20px' })
    expect(designScopeRadiusStyle('default')).toBeUndefined()
  })

  it('renders onto its child with asChild', () => {
    render(
      <DesignScope asChild density="compact">
        <section data-testid="section">content</section>
      </DesignScope>,
    )
    expect(screen.getByTestId('section')).toHaveAttribute('data-density', 'compact')
  })
})
