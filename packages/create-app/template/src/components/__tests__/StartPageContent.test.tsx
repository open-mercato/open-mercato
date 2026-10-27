/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StartPageContent } from '../StartPageContent'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

jest.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ id }: { id: string }) => <input id={id} type="checkbox" readOnly />,
}))

describe('StartPageContent', () => {
  it('renders the server-resolved apiBaseUrl prop, not an env-derived value', () => {
    const previousAppUrl = process.env.APP_URL
    process.env.APP_URL = 'http://localhost:3002'
    try {
      render(
        <StartPageContent
          showStartPage
          apiBaseUrl="https://erp.example.com/api"
        />,
      )
      expect(screen.getByText('https://erp.example.com/api')).toBeInTheDocument()
      expect(screen.queryByText('http://localhost:3002/api')).not.toBeInTheDocument()
    } finally {
      if (previousAppUrl === undefined) delete process.env.APP_URL
      else process.env.APP_URL = previousAppUrl
    }
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
  ])(
    'does not resolve the API base URL client-side (hydration-safety guard): %s',
    (componentPath) => {
      const source = readFileSync(componentPath, 'utf8')
      expect(source).not.toContain('resolveApiDocsBaseUrl')
      expect(source).toContain('apiBaseUrl')
    },
  )
})
