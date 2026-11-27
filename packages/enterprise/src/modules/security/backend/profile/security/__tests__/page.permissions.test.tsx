/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import SecurityProfilePage from '../page'

let mockGrantedFeatures: string[] | undefined

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: mockGrantedFeatures ? { grantedFeatures: mockGrantedFeatures } : null }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({ InjectionSpot: () => null }))
jest.mock('../../../../components/PasswordChangeForm', () => ({
  __esModule: true,
  default: () => <button type="button">Save password</button>,
}))
jest.mock('../../../../components/MfaSettingsRedirect', () => ({
  __esModule: true,
  default: () => <a href="/backend/profile/security/mfa">MFA settings</a>,
}))

describe('SecurityProfilePage password controls', () => {
  it('withholds password controls before permissions load and for view-only access', () => {
    mockGrantedFeatures = undefined
    const { rerender } = render(<SecurityProfilePage />)

    expect(screen.queryByRole('button', { name: 'Save password' })).toBeNull()
    mockGrantedFeatures = ['security.profile.view']
    rerender(<SecurityProfilePage />)

    expect(screen.queryByRole('button', { name: 'Save password' })).toBeNull()
    expect(screen.getByRole('link', { name: 'MFA settings' })).toBeTruthy()
  })

  it.each(['security.profile.password', 'security.*', '*'])('shows the password form with %s', (feature) => {
    mockGrantedFeatures = ['security.profile.view', feature]
    render(<SecurityProfilePage />)

    expect(screen.getByRole('button', { name: 'Save password' })).toBeTruthy()
  })
})
