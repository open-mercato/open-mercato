/**
 * @jest-environment jsdom
 */

import fs from 'node:fs'
import path from 'node:path'
import type { ReactElement, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

jest.mock('@open-mercato/core/modules/auth/frontend/login', () => ({
  __esModule: true,
  default: () => null,
}))

import LoginRoutePage from '../login/page'

describe('login route graph', () => {
  it('serves /login through a direct route instead of the generated frontend catch-all', () => {
    const routePath = path.join(process.cwd(), 'src/app/login/page.tsx')
    const source = fs.readFileSync(routePath, 'utf8')

    expect(source).toContain('@open-mercato/core/modules/auth/frontend/login')
    expect(source).not.toContain('frontend-routes.generated')
    expect(source).not.toContain('@/bootstrap')
  })

  it('shows an accessible loading indicator while the login page hydrates', () => {
    const route = LoginRoutePage() as ReactElement<{ fallback: ReactNode }>

    expect(route.props.fallback).not.toBeNull()

    render(
      <I18nProvider locale="en" dict={{}}>
        {route.props.fallback}
      </I18nProvider>,
    )

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })
})
