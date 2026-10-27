/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render } from '@testing-library/react'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentOverrideProvider } from '../ComponentOverrideProvider'
import { useRegisteredComponent } from '../useRegisteredComponent'

const COMPONENT_ID = 'section:test.host.form'

function Section({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

function Host() {
  const Resolved = useRegisteredComponent<{ children: React.ReactNode }>(COMPONENT_ID, Section)
  return (
    <Resolved>
      <form>
        <input id="email" name="email" defaultValue="" />
      </form>
    </Resolved>
  )
}

/**
 * `overrides` arrives as a brand-new array once the async override bundle
 * resolves, exactly the way ComponentOverridesBootstrap hands it over after its
 * dynamic import settles.
 */
function App({ overrides }: { overrides: ComponentOverride[] }) {
  return (
    <ComponentOverrideProvider overrides={overrides}>
      <Host />
    </ComponentOverrideProvider>
  )
}

function readEmail(): HTMLInputElement {
  return document.querySelector('#email') as HTMLInputElement
}

function typeEmail(value: string): HTMLInputElement {
  const email = readEmail()
  fireEvent.change(email, { target: { value } })
  expect(email.value).toBe(value)
  return email
}

describe('useRegisteredComponent — a late override registry must not discard host state', () => {
  it('keeps typed input when the override bundle resolves with no override for this id', () => {
    const { rerender } = render(<App overrides={[]} />)
    const email = typeEmail('admin@acme.com')

    // Same (empty) override set, fresh array identity — the registry revision bumps.
    rerender(<App overrides={[]} />)

    expect(readEmail()).toBe(email)
    expect(readEmail().value).toBe('admin@acme.com')
  })

  it('keeps typed input when unrelated overrides register', () => {
    const { rerender } = render(<App overrides={[]} />)
    const email = typeEmail('admin@acme.com')

    const unrelated: ComponentOverride[] = [{
      target: { componentId: 'section:some.other.component' },
      priority: 0,
      metadata: { module: 'other' },
      wrapper: (Original) => Original,
    }]
    rerender(<App overrides={unrelated} />)

    expect(readEmail()).toBe(email)
    expect(readEmail().value).toBe('admin@acme.com')
  })

  it('still applies a wrapper registered for this id', () => {
    const withBanner: ComponentOverride[] = [{
      target: { componentId: COMPONENT_ID },
      priority: 0,
      metadata: { module: 'other' },
      wrapper: (Original) => {
        const Wrapped = (props: Record<string, unknown>) => (
          <div data-testid="wrapper-banner">{React.createElement(Original as React.ComponentType<Record<string, unknown>>, props)}</div>
        )
        return Wrapped as typeof Original
      },
    }]

    const { getByTestId } = render(<App overrides={withBanner} />)

    expect(getByTestId('wrapper-banner')).toBeTruthy()
    expect(readEmail()).toBeTruthy()
  })
})
