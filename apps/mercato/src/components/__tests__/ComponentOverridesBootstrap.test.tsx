/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getComponentOverrides, registerComponentOverrides } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentOverridesBootstrap } from '../ComponentOverridesBootstrap'

jest.mock('@/.mercato/generated/component-overrides.generated', () => ({
  componentOverrideEntries: [{ componentOverrides: [{ target: { componentId: 'test' }, priority: 1 }] }],
}))

describe('ComponentOverridesBootstrap', () => {
  afterEach(() => {
    registerComponentOverrides([])
  })

  it('preserves child state when asynchronous overrides activate', async () => {
    function StatefulChild() {
      const [count, setCount] = React.useState(0)
      return (
        <button type="button" onClick={() => setCount((value) => value + 1)}>
          Count {count}
        </button>
      )
    }

    render(
      <ComponentOverridesBootstrap profile="login">
        <StatefulChild />
      </ComponentOverridesBootstrap>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Count 0' }))
    expect(screen.getByRole('button', { name: 'Count 1' })).toBeEnabled()
    await waitFor(() => expect(getComponentOverrides('test')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Count 1' })).toBeEnabled()
  })
})
