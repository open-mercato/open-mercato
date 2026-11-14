/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DocumentStructurePanel } from '../DocumentStructurePanel'

type MockCall = { ok: boolean; status: number; result: unknown }

const apiCallMock = jest.fn<Promise<MockCall>, [string, RequestInit | undefined]>()
const runMutationMock = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
const flashMock = jest.fn()

jest.mock('../../utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(args[0] as string, args[1] as RequestInit | undefined),
}))

jest.mock('../../FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('../../injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (input: { operation: () => Promise<unknown> }) => runMutationMock(input),
    retryLastMutation: jest.fn(async () => false),
  }),
}))

const attachmentId = 'att-1'

const completedStructure = {
  attachmentId,
  extraction: { id: 'ext-1', status: 'completed', pageCount: 12, sectionCount: 40, skipReason: null },
  outline: [
    { id: 'chapter-1', parentId: 'root', kind: 'chapter', numberLabel: '1', heading: 'Scope', pageStart: 1, pageEnd: 3, anchorKey: 'a1', childCount: 1 },
    { id: 'section-1-1', parentId: 'chapter-1', kind: 'section', numberLabel: '1.1', heading: 'Definitions', pageStart: 2, pageEnd: 2, anchorKey: 'a2', childCount: 0 },
  ],
}

function ok(result: unknown, status = 200): MockCall {
  return { ok: true, status, result }
}

describe('DocumentStructurePanel', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    runMutationMock.mockClear()
    flashMock.mockReset()
  })

  it('renders the outline and lazily loads children when a node is expanded', async () => {
    apiCallMock.mockImplementation(async (url) => {
      if (url.includes('/sections?')) {
        return ok({
          extractionId: 'ext-1',
          items: [{ id: 'clause-1', parentId: 'section-1-1', kind: 'clause', numberLabel: '1.1.1', heading: 'Terms', pageStart: 2, pageEnd: 2 }],
          nextCursor: null,
        })
      }
      return ok(completedStructure)
    })

    renderWithProviders(<DocumentStructurePanel attachmentId={attachmentId} canManage />)

    expect(await screen.findByText('1 Scope')).toBeInTheDocument()
    expect(screen.getByText('1.1 Definitions')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(apiCallMock.mock.calls[0][0]).toBe('/api/attachments/structure/att-1?includeOutline=true&maxDepth=2')

    const expandButton = screen.getByRole('button', { name: 'Expand 1.1 Definitions' })
    expect(expandButton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(expandButton)

    expect(await screen.findByText('1.1.1 Terms')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse 1.1 Definitions' })).toHaveAttribute('aria-expanded', 'true')
    const sectionsUrl = apiCallMock.mock.calls.map(([url]) => url).find((url) => url.includes('/sections?'))
    expect(sectionsUrl).toContain('/api/attachments/structure/att-1/sections?')
    expect(sectionsUrl).toContain('parentId=section-1-1')
    expect(sectionsUrl).toContain('includeText=false')
    expect(sectionsUrl).toContain('limit=100')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse 1 Scope' }))
    await waitFor(() => expect(screen.queryByText('1.1 Definitions')).not.toBeInTheDocument())
  })

  it('shows the not-extracted empty state and requests extraction through the guarded mutation', async () => {
    let requested = false
    apiCallMock.mockImplementation(async (url, init) => {
      if (init?.method === 'POST') {
        requested = true
        return ok({ attachmentId, extractionId: null, status: 'pending' }, 202)
      }
      return ok({ attachmentId, extraction: null, outline: [] })
    })

    renderWithProviders(<DocumentStructurePanel attachmentId={attachmentId} canManage />)

    expect(await screen.findByText('Structure not extracted yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Extract structure' }))

    await waitFor(() => expect(requested).toBe(true))
    expect(runMutationMock).toHaveBeenCalledTimes(1)
    const postCall = apiCallMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(postCall?.[0]).toBe('/api/attachments/structure/att-1')
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ force: false })
    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Document structure extraction queued.', 'success'))
    expect(await screen.findByText('Extraction queued')).toBeInTheDocument()
  })

  it('hides the extract action without the manage feature', async () => {
    apiCallMock.mockImplementation(async (url) => {
      if (url === '/api/auth/feature-check') return ok({ granted: [] })
      return ok({ attachmentId, extraction: null, outline: [] })
    })

    renderWithProviders(<DocumentStructurePanel attachmentId={attachmentId} />)

    expect(await screen.findByText('Structure not extracted yet')).toBeInTheDocument()
    await waitFor(() =>
      expect(apiCallMock.mock.calls.some(([url]) => url === '/api/auth/feature-check')).toBe(true),
    )
    expect(screen.queryByRole('button', { name: 'Extract structure' })).not.toBeInTheDocument()
  })

  it('surfaces a server rejection of the extraction request', async () => {
    apiCallMock.mockImplementation(async (url, init) => {
      if (init?.method === 'POST') return { ok: false, status: 422, result: { error: 'Unsupported file type' } }
      return ok({
        attachmentId,
        extraction: { id: 'ext-2', status: 'skipped', pageCount: null, sectionCount: 0, skipReason: 'unsupported_type' },
        outline: [],
      })
    })

    renderWithProviders(<DocumentStructurePanel attachmentId={attachmentId} canManage />)

    expect(await screen.findByText('Skipped')).toBeInTheDocument()
    expect(screen.getByText('This file type does not support document structure extraction.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Re-extract' }))
    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Unsupported file type', 'error'))
    const postCall = apiCallMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ force: true })
  })

  it('renders an error state when the structure cannot be loaded', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 500, result: { error: 'boom' } })

    renderWithProviders(<DocumentStructurePanel attachmentId={attachmentId} canManage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load the document structure.')
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
  })
})
