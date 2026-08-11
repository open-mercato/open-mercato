/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getComponentOverrides, registerComponentOverrides } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { ComponentOverridesBootstrap } from '../ComponentOverridesBootstrap'

jest.mock('@/.mercato/generated/component-overrides.generated', () => ({
  componentOverrideEntries: [{
    componentOverrides: [{
      target: { componentId: 'test' },
      priority: 1,
      propsTransform: (props: { label: string }) => ({ ...props, label: 'Override active' }),
    }],
  }],
}))

describe('ComponentOverridesBootstrap', () => {
  afterEach(() => {
    registerComponentOverrides([])
  })

  it('preserves child state and updates mounted consumers when asynchronous overrides activate', async () => {
    function Label({ label }: { label: string }) {
      return <span>{label}</span>
    }

    function StatefulChild() {
      const [count, setCount] = React.useState(0)
      const ResolvedLabel = useRegisteredComponent<{ label: string }>('test', Label)
      return (
        <>
          <button type="button" onClick={() => setCount((value) => value + 1)}>
            Count {count}
          </button>
          <ResolvedLabel label="Fallback active" />
        </>
      )
    }

    render(
      <ComponentOverridesBootstrap profile="login">
        <StatefulChild />
      </ComponentOverridesBootstrap>,
    )

    expect(screen.getByText('Fallback active')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Count 0' }))
    expect(screen.getByRole('button', { name: 'Count 1' })).toBeEnabled()
    await waitFor(() => expect(getComponentOverrides('test')).toHaveLength(1))
    await waitFor(() => expect(screen.getByText('Override active')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Count 1' })).toBeEnabled()
  })

  it('preserves registered component state across disabled-profile rerenders', () => {
    function StatefulLabel() {
      const [count, setCount] = React.useState(0)
      return (
        <button type="button" onClick={() => setCount((value) => value + 1)}>
          Local {count}
        </button>
      )
    }

    function Consumer() {
      const ResolvedLabel = useRegisteredComponent('stateful-test', StatefulLabel)
      return <ResolvedLabel />
    }

    const { rerender } = render(
      <ComponentOverridesBootstrap profile="public">
        <Consumer />
      </ComponentOverridesBootstrap>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Local 0' }))
    expect(screen.getByRole('button', { name: 'Local 1' })).toBeEnabled()

    rerender(
      <ComponentOverridesBootstrap profile="public">
        <Consumer />
      </ComponentOverridesBootstrap>,
    )

    expect(screen.getByRole('button', { name: 'Local 1' })).toBeEnabled()
  })
})
