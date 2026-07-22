/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { PersonDetailTabs } from '../PersonDetailTabs'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

describe('PersonDetailTabs', () => {
  it('renders an Addresses tab', () => {
    render(
      <PersonDetailTabs activeTab="activities" onTabChange={() => {}}>
        <div>content</div>
      </PersonDetailTabs>,
    )
    expect(screen.getByRole('tab', { name: /address/i })).toBeInTheDocument()
  })
})
