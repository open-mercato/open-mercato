/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { useComponentOverridesReadiness } from '@open-mercato/ui/backend/injection/ComponentOverrideProvider'
import { ComponentOverridesBootstrap } from '../ComponentOverridesBootstrap'

const mockEnsureOverrides = jest.fn()
jest.mock('../ClientBootstrap', () => ({
  ensureModuleOverridesApplied: () => mockEnsureOverrides(),
  profileUsesComponentOverrides: (profile: string) => profile !== 'public',
}))

function Readiness() {
  return <output>{useComponentOverridesReadiness()}</output>
}

it('settles a failed deferred load without starting another from its error render', async () => {
  mockEnsureOverrides.mockRejectedValue(new Error('Fixture import failed'))
  const { rerender } = render(<ComponentOverridesBootstrap profile="backend"><Readiness /></ComponentOverridesBootstrap>)
  await screen.findByText('failed')
  expect(mockEnsureOverrides).toHaveBeenCalledTimes(1)
  rerender(<ComponentOverridesBootstrap profile="backend"><Readiness /><span>Still mounted</span></ComponentOverridesBootstrap>)
  expect(screen.getByText('failed')).toBeInTheDocument()
  expect(mockEnsureOverrides).toHaveBeenCalledTimes(1)
  rerender(<ComponentOverridesBootstrap profile="public"><Readiness /></ComponentOverridesBootstrap>)
  expect(screen.getByText('ready')).toBeInTheDocument()
  rerender(<ComponentOverridesBootstrap profile="backend"><Readiness /></ComponentOverridesBootstrap>)
  await waitFor(() => expect(mockEnsureOverrides).toHaveBeenCalledTimes(2))
  await screen.findByText('failed')
})
