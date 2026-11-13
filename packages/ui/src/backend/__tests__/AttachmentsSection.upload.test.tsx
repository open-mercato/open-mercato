/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AttachmentsSection } from '../detail/AttachmentsSection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('../injection/useRegisteredComponent', () => ({
  useRegisteredComponent: <T,>(_handle: string, fallback?: React.ComponentType<T>) =>
    fallback ?? ((() => null) as React.ComponentType<T>),
}))

jest.mock('../detail/AttachmentMetadataDialog', () => ({
  AttachmentMetadataDialog: () => null,
}))

jest.mock('../detail/AttachmentDeleteDialog', () => ({
  AttachmentDeleteDialog: () => null,
}))

const REJECTION = 'Executable file types are not allowed as attachments.'

type StoredItem = { id: string; fileName: string; fileSize: number; mimeType: string }

/**
 * Emulates `/api/attachments` for one record: POST persists the file unless its
 * name ends in `.exe` (the route's dangerous-executable 400), GET lists what was
 * persisted. `holdUploads` parks each POST until `releaseUpload` is called so a
 * test can interact with the section while an upload is in flight.
 */
function createServer({ holdUploads = false } = {}) {
  const stored: StoredItem[] = []
  const posted: string[] = []
  const pending: Array<() => void> = []
  let holding = holdUploads
  let listCalls = 0
  ;(apiCall as jest.Mock).mockImplementation(async (url: string, init?: { method?: string; body?: FormData }) => {
    if (init?.method === 'POST') {
      const file = init.body?.get('file') as File
      posted.push(file.name)
      if (holding) await new Promise<void>((resolve) => pending.push(resolve))
      if (file.name.endsWith('.exe')) {
        return { ok: false, status: 400, result: { error: REJECTION }, response: { status: 400 } }
      }
      const item = { id: `att-${stored.length + 1}`, fileName: file.name, fileSize: file.size, mimeType: 'text/plain' }
      stored.push(item)
      return { ok: true, status: 200, result: { ok: true, item }, response: { status: 200 } }
    }
    if (url.startsWith('/api/attachments?')) {
      listCalls += 1
      return { ok: true, status: 200, result: { items: [...stored], page: 1, pageSize: 24 }, response: { status: 200 } }
    }
    return { ok: true, status: 200, result: {}, response: { status: 200 } }
  })
  return {
    stored,
    posted,
    listCalls: () => listCalls,
    pendingUploads: () => pending.length,
    releaseAll: () => {
      holding = false
      pending.splice(0).forEach((resolve) => resolve())
    },
  }
}

function textFile(name: string): File {
  return new File([`harmless text for ${name}`], name, { type: 'text/plain' })
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('file input not rendered')
  return input as HTMLInputElement
}

function selectFiles(container: HTMLElement, names: string[]) {
  fireEvent.change(fileInput(container), { target: { files: names.map(textFile) } })
}

async function renderSection(onChanged = jest.fn()) {
  const view = renderWithProviders(
    <AttachmentsSection entityId="customers:customer_entity" recordId="record-1" onChanged={onChanged} />,
    { dict: {} },
  )
  await screen.findByText('No attachments found.')
  return { ...view, onChanged }
}

async function waitForIdle() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Choose files' })).toBeEnabled())
}

describe('AttachmentsSection multi-file upload (#6397)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('uploads every file and refreshes the list when all succeed', async () => {
    const server = createServer()
    const { container, onChanged } = await renderSection()

    selectFiles(container, ['ok-a.txt', 'ok-b.txt', 'ok-c.txt'])

    expect(await screen.findByText('ok-c.txt')).toBeInTheDocument()
    await waitForIdle()
    expect(server.posted).toEqual(['ok-a.txt', 'ok-b.txt', 'ok-c.txt'])
    expect(screen.getByText('ok-a.txt')).toBeInTheDocument()
    expect(screen.getByText('ok-b.txt')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('stops at a rejected first file, announces the error and changes nothing', async () => {
    const server = createServer()
    const { container, onChanged } = await renderSection()

    selectFiles(container, ['blocked.exe', 'ok-b.txt', 'ok-c.txt'])

    expect(await screen.findByRole('alert')).toHaveTextContent(REJECTION)
    await waitForIdle()
    expect(server.posted).toEqual(['blocked.exe'])
    expect(server.stored).toHaveLength(0)
    expect(screen.getByText('No attachments found.')).toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('shows the files saved before a rejected middle file without a reload', async () => {
    const server = createServer()
    const { container, onChanged } = await renderSection()
    const listCallsBefore = server.listCalls()

    selectFiles(container, ['scout-first.txt', 'scout-blocked.exe', 'scout-last.txt'])

    expect(await screen.findByText('scout-first.txt')).toBeInTheDocument()
    await waitForIdle()
    expect(server.posted).toEqual(['scout-first.txt', 'scout-blocked.exe'])
    expect(server.listCalls()).toBeGreaterThan(listCallsBefore)
    expect(screen.getByRole('alert')).toHaveTextContent(REJECTION)
    expect(screen.queryByText('No attachments found.')).toBeNull()
    expect(screen.queryByText('scout-last.txt')).toBeNull()
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('shows every file saved before a rejected last file', async () => {
    const server = createServer()
    const { container } = await renderSection()

    selectFiles(container, ['last-a.txt', 'last-b.txt', 'last-blocked.exe'])

    expect(await screen.findByText('last-b.txt')).toBeInTheDocument()
    await waitForIdle()
    expect(server.posted).toEqual(['last-a.txt', 'last-b.txt', 'last-blocked.exe'])
    expect(screen.getByText('last-a.txt')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(REJECTION)
  })

  it('ignores a second selection or drop while a batch is uploading', async () => {
    const server = createServer({ holdUploads: true })
    const { container } = await renderSection()

    selectFiles(container, ['drop-a.txt', 'drop-b.txt'])
    await waitFor(() => expect(server.pendingUploads()).toBe(1))

    selectFiles(container, ['late-select.txt'])
    const dropZone = container.querySelector('[role="presentation"]') as HTMLElement
    fireEvent.drop(dropZone, { dataTransfer: { files: [textFile('late-drop.txt')] } })

    await act(async () => {
      server.releaseAll()
    })
    await waitForIdle()
    await waitFor(() => expect(screen.getByText('drop-b.txt')).toBeInTheDocument())

    expect(server.posted).toEqual(['drop-a.txt', 'drop-b.txt'])
    expect(server.stored.map((item) => item.fileName)).toEqual(['drop-a.txt', 'drop-b.txt'])
  })
})
