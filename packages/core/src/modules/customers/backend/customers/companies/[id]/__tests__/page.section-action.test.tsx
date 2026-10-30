/**
 * @jest-environment jsdom
 */

// Regression coverage for issue #6358: the tab section action (e.g. "Add task")
// registered by a section on mount must survive the tab switch that mounted it.

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import CompanyDetailPage from '../page'

const readApiResultOrThrowMock = jest.fn()

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => '/backend/customers/companies/test',
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/separator', () => ({
  Separator: () => null,
}))

jest.mock('@open-mercato/ui/primitives/spinner', () => ({
  Spinner: () => <div>spinner</div>,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  NotesSection: () => null,
  RecordNotFoundState: ({ label }: { label: string }) => <div data-testid="record-not-found">{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div data-testid="error-message">{label}</div>,
  DetailFieldsSection: () => null,
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [] }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async <T,>({ operation }: { operation: () => Promise<T> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))

jest.mock('@open-mercato/ui/backend/messages', () => ({
  SendObjectMessageDialog: () => null,
}))

jest.mock('../../../../../components/detail/ActivitiesSection', () => ({ ActivitiesSection: () => null }))
jest.mock('../../../../../components/detail/TagsSection', () => ({ TagsSection: () => null }))
jest.mock('../../../../../components/detail/DealsSection', () => ({ DealsSection: () => null }))
jest.mock('../../../../../components/detail/AddressesSection', () => ({ AddressesSection: () => null }))
jest.mock('../../../../../components/detail/TasksSection', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react')
  type ActionChange = (action: { label: string; onClick: () => void } | null) => void
  return {
    TasksSection: ({ onActionChange, addActionLabel }: { onActionChange?: ActionChange; addActionLabel: string }) => {
      ReactActual.useEffect(() => {
        onActionChange?.({ label: addActionLabel, onClick: () => {} })
        return () => onActionChange?.(null)
      }, [addActionLabel, onActionChange])
      return <div data-testid="tasks-section" />
    },
  }
})
jest.mock('../../../../../components/detail/CustomDataSection', () => ({ CustomDataSection: () => null }))
jest.mock('../../../../../components/detail/CompanyHighlights', () => ({ CompanyHighlights: () => null }))
jest.mock('../../../../../components/detail/CompanyPeopleSection', () => ({ CompanyPeopleSection: () => null }))
jest.mock('../../../../../components/detail/AnnualRevenueField', () => ({ AnnualRevenueField: () => null }))
jest.mock('../../../../../components/detail/DetailTabsLayout', () => ({
  DetailTabsLayout: ({
    tabs,
    onTabChange,
    sectionAction,
    children,
  }: {
    tabs: Array<{ id: string; label: string }>
    onTabChange: (id: string) => void
    sectionAction: { label: string } | null
    children: React.ReactNode
  }) => (
    <div>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" data-testid={`tab-${tab.id}`} onClick={() => onTabChange(tab.id)}>
          {tab.label}
        </button>
      ))}
      {sectionAction ? <button type="button" data-testid="section-action">{sectionAction.label}</button> : null}
      {children}
    </div>
  ),
}))
jest.mock('../../../../../components/detail/InlineEditors', () => ({
  renderMultilineMarkdownDisplay: () => null,
  InlineDictionaryEditor: () => null,
}))

describe('CustomerCompanyDetailPage — tab section action (#6358)', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockResolvedValue({
      company: {
        id: '2408107d-0000-4000-8000-000000000001',
        displayName: 'Harborview Analytics',
      },
      profile: null,
      customFields: {},
      tags: [],
      addresses: [],
      comments: [],
      activities: [],
      deals: [],
      todos: [],
      people: [],
    })
  })

  it('keeps the Add task action after switching to the Tasks tab', async () => {
    renderWithProviders(<CompanyDetailPage params={{ id: '2408107d-0000-4000-8000-000000000001' }} />)

    const tasksTab = await screen.findByTestId('tab-tasks')
    fireEvent.click(tasksTab)

    await screen.findByTestId('tasks-section')
    await waitFor(() => {
      expect(screen.getByTestId('section-action')).toHaveTextContent('Add task')
    })
  })

  it('clears the Add task action when leaving the Tasks tab', async () => {
    renderWithProviders(<CompanyDetailPage params={{ id: '2408107d-0000-4000-8000-000000000001' }} />)

    fireEvent.click(await screen.findByTestId('tab-tasks'))
    await waitFor(() => {
      expect(screen.getByTestId('section-action')).toHaveTextContent('Add task')
    })

    fireEvent.click(screen.getByTestId('tab-deals'))
    await waitFor(() => {
      expect(screen.queryByTestId('section-action')).not.toBeInTheDocument()
    })
  })
})
