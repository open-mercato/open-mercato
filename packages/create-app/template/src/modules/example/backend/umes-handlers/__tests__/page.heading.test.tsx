/** @jest-environment jsdom */

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PageBody: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({
  useAppEvent: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

jest.mock('@open-mercato/ui/backend/injection/useInjectedMenuItems', () => ({
  useInjectedMenuItems: () => ({ items: [], isLoading: false }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({
    title,
    titleHeadingLevel,
  }: {
    title: React.ReactNode
    titleHeadingLevel: 1 | 2 | 3
  }) => {
    const Heading = `h${titleHeadingLevel}` as const
    return <Heading>{title}</Heading>
  },
}))

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import UmesHandlersPage from '../page'

describe('UmesHandlersPage heading hierarchy', () => {
  it('renders one page heading with the CRUD form title nested beneath it', () => {
    render(<UmesHandlersPage />)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'example.umes.handlers.page.title' })).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: 'example.umes.handlers.form.title' })).toBeVisible()
  })
})
