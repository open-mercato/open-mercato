/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StartPageContent } from '../StartPageContent'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string, params?: Record<string, string | number>) =>
    Object.entries(params ?? {}).reduce(
      (text, [name, value]) => text.replace(`{${name}}`, String(value)),
      fallback ?? key,
    ),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

jest.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ id }: { id: string }) => <input id={id} type="checkbox" readOnly />,
}))

describe('StartPageContent', () => {
  const demoAccounts = [
    { role: 'superadmin' as const, email: 'superadmin@acme.com' },
    { role: 'admin' as const, email: 'admin@acme.com' },
    { role: 'employee' as const, email: 'employee@acme.com' },
  ]

  it('guides the visitor once and offers every role in the account chooser', () => {
    render(<StartPageContent showStartPage demoAccounts={demoAccounts} />)

    const guide = within(screen.getByRole('region', { name: 'Getting started' }))
    expect(guide.getByRole('button', { name: 'Copy password' })).toBeInTheDocument()
    expect(guide.queryByRole('link')).not.toBeInTheDocument()

    const chooser = within(screen.getByRole('region', { name: 'Choose a role' }))
    const cards = chooser.getAllByRole('article')
    expect(cards).toHaveLength(demoAccounts.length)
    for (const [index, { role, email }] of demoAccounts.entries()) {
      const link = within(cards[index]).getByRole('link')
      expect(within(link).getByRole('heading', { level: 3 })).toBeInTheDocument()
      expect(link).toHaveAccessibleDescription()
      expect(link).toHaveAttribute('href', `/login?role=${role}&email=${encodeURIComponent(email)}`)
    }
  })

  it('offers the app instead of demo accounts to a signed-in visitor', () => {
    render(<StartPageContent showStartPage signedIn demoAccounts={demoAccounts} />)

    expect(screen.getByRole('link', { name: 'Go to the app' })).toHaveAttribute('href', '/backend')
    expect(screen.queryByText('admin@acme.com')).not.toBeInTheDocument()
    expect(screen.queryByText('secret')).not.toBeInTheDocument()
  })

  it('hides the superadmin login when self-service onboarding is offered', () => {
    render(<StartPageContent showStartPage showOnboardingCta demoAccounts={demoAccounts} />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Getting started')
    expect(screen.getByRole('heading', { level: 2, name: 'Launch your own workspace' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create a workspace' })).toHaveAttribute('href', '/onboarding')
    expect(screen.queryByRole('link', { name: 'Log in as Super Admin' })).not.toBeInTheDocument()
    expect(screen.queryByText('superadmin@acme.com')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Log in as Employee' })).toBeInTheDocument()
  })

  it('lists the next steps with their commands and the module catalog', () => {
    render(<StartPageContent showStartPage />)

    expect(screen.getByText('npx cezar-run')).toBeInTheDocument()
    expect(screen.getByText('npx create-mercato-module init visits')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the module catalog' })).toHaveAttribute(
      'href',
      'https://modules.openmercato.com',
    )
  })

  it('lists only the setup that is still missing', () => {
    const { rerender } = render(<StartPageContent showStartPage pendingSetup={['email']} />)

    expect(screen.getByRole('heading', { name: 'Still to set up' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Outgoing email' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'AI provider' })).not.toBeInTheDocument()

    rerender(<StartPageContent showStartPage pendingSetup={[]} />)

    expect(screen.queryByRole('heading', { name: 'Still to set up' })).not.toBeInTheDocument()
  })

  it('reports an unreachable database', () => {
    render(<StartPageContent showStartPage databaseReachable={false} demoAccounts={demoAccounts} />)

    expect(screen.getByRole('alert')).toHaveTextContent('The database is not reachable')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Connect the database')
    expect(screen.queryByRole('link', { name: /Log in as/ })).not.toBeInTheDocument()
  })

  it.each([
    join(__dirname, '..', 'StartPageContent.tsx'),
    join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      'packages',
      'create-app',
      'template',
      'src',
      'components',
      'StartPageContent.tsx',
    ),
  ])('does not resolve environment-derived URLs client-side (hydration-safety guard): %s', (componentPath) => {
    const source = readFileSync(componentPath, 'utf8')
    expect(source).not.toContain('resolveApiDocsBaseUrl')
    expect(source).not.toContain('process.env')
  })
})
