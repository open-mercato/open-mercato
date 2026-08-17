/** @jest-environment jsdom */

import * as React from 'react'
import { act, render, screen } from '@testing-library/react'

const apiCallMock = jest.fn()
const translate = (key: string) => key

jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => function MockEditorIsland() { return <div>editor</div> },
}))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: jest.fn(),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({ buildOptimisticLockHeader: () => ({}) }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => false), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate }))
jest.mock('@open-mercato/ui/primitives/link-button', () => ({ LinkButton: () => null }))
jest.mock('@open-mercato/ui/primitives/tooltip', () => ({
  SimpleTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
jest.mock('../backend/documents/[id]/CommentsRail', () => ({ CommentsRail: () => null }))
jest.mock('../backend/documents/[id]/ExportMenu', () => ({ ExportMenu: () => null }))
jest.mock('../backend/documents/[id]/RelatedRecordsPanel', () => ({ RelatedRecordsPanel: () => null }))
jest.mock('../backend/documents/[id]/DocumentNavigator', () => ({ DocumentNavigator: () => null }))
jest.mock('../backend/documents/[id]/VersionHistoryPanel', () => ({
  VersionHistoryPanel: () => <section>versions-panel</section>,
}))
jest.mock('../backend/documents/[id]/DocumentEditorErrorBoundary', () => ({
  DocumentEditorErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
jest.mock('../backend/documents/components/ShareDialog', () => ({ ShareDialog: () => null }))

import { DocumentPageClient, revealPanelInScrollContainer } from '../backend/documents/[id]/DocumentPageClient'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const UPDATED_AT = '2026-07-15T08:00:00.000Z'

function installMatchMedia(reducedMotion: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: reducedMotion && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  })
}

describe('versions panel reveal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    installMatchMedia(false)
    apiCallMock.mockImplementation(async (path: string) => {
      if (path === `/api/documents/${DOCUMENT_ID}`) {
        return {
          ok: true,
          status: 200,
          result: {
            id: DOCUMENT_ID,
            title: 'Quarterly report',
            updatedAt: UPDATED_AT,
            archivedAt: null,
            capabilities: {
              canView: true, canComment: true, canEdit: true, canShare: true, canDelete: true,
              canCreate: true, canManageTemplates: false, canArchive: true, canDuplicate: true,
            },
          },
        }
      }
      if (path === `/api/documents/${DOCUMENT_ID}/content`) {
        return { ok: true, status: 200, result: { contentHtml: '<p>Body</p>', updatedAt: UPDATED_AT } }
      }
      throw new Error(`Unexpected API call: ${path}`)
    })
  })

  it('scrolls the nearest scrollable ancestor so the panel lands at its top', () => {
    const rail = document.createElement('aside')
    rail.style.overflowY = 'auto'
    Object.defineProperty(rail, 'scrollHeight', { configurable: true, value: 1200 })
    Object.defineProperty(rail, 'clientHeight', { configurable: true, value: 600 })
    rail.scrollTop = 40
    rail.getBoundingClientRect = () => ({ top: 100 } as DOMRect)
    const scrollTo = jest.fn()
    rail.scrollTo = scrollTo as unknown as typeof rail.scrollTo
    const panel = document.createElement('div')
    panel.getBoundingClientRect = () => ({ top: 900 } as DOMRect)
    rail.appendChild(panel)
    document.body.appendChild(rail)

    revealPanelInScrollContainer(panel)
    expect(scrollTo).toHaveBeenCalledWith({ top: 900 - 100 + 40 - 16, behavior: 'smooth' })

    installMatchMedia(true)
    revealPanelInScrollContainer(panel)
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'auto' }))
    rail.remove()
  })

  it('falls back to scrollIntoView when no ancestor scrolls', () => {
    const panel = document.createElement('div')
    const scrollIntoView = jest.fn()
    panel.scrollIntoView = scrollIntoView
    document.body.appendChild(panel)

    revealPanelInScrollContainer(panel)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    panel.remove()
  })

  it('reveals and focuses the versions panel when it is opened, not when it is closed', async () => {
    const scrollIntoView = jest.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    render(<DocumentPageClient documentId={DOCUMENT_ID} />)
    const toggle = await screen.findByRole('button', { name: /documents\.actions\.versions/ })

    await act(async () => { toggle.click() })
    const panel = await screen.findByText('versions-panel')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(panel.parentElement)

    await act(async () => { toggle.click() })
    expect(screen.queryByText('versions-panel')).toBeNull()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })
})
