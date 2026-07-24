/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { ComponentOverridesBootstrap } from '../ComponentOverridesBootstrap'

jest.mock('@/.mercato/generated/component-overrides.generated', () => ({
  componentOverrideEntries: [{ componentOverrides: [{ target: { componentId: 'test' }, priority: 1 }] }],
}))

jest.mock('@open-mercato/ui/backend/injection/ComponentOverrideProvider', () => ({
  ComponentOverrideProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="override-provider">{children}</div>
  ),
}))

describe('ComponentOverridesBootstrap', () => {
  it('hydrates children without suspending and activates overrides asynchronously', async () => {
    render(
      <ComponentOverridesBootstrap profile="login">
        <button type="button">Sign in</button>
      </ComponentOverridesBootstrap>,
    )

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    await waitFor(() => expect(screen.getByTestId('override-provider')).toBeInTheDocument())
  })
})
