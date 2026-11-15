/**
 * @jest-environment jsdom
 *
 * Guards issue #6397: a multi-file library upload stops at the first file the
 * server rejects. Files acknowledged before the rejection must show up in the
 * library straight away and must not be sent again when the user retries the
 * same dialog, while the failed and never-attempted files stay queued.
 *
 * CrudForm is replaced by a minimal host that renders the real custom field
 * components and forwards submit to the real `onSubmit`, so the test covers the
 * upload loop and the selected-files list without the full form runtime.
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AttachmentLibrary } from '../AttachmentLibrary'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/backend/storage/attachments',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ actions }: { actions?: React.ReactNode }) => <div data-testid="library-actions">{actions}</div>,
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

const flashMock = jest.fn()
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

let presetFormValues: Record<string, unknown> = {}

jest.mock('@open-mercato/ui/backend/CrudForm', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react')
  type StubField = { id: string; type: string; component?: (props: Record<string, unknown>) => React.ReactNode }
  type StubProps = {
    fields: StubField[]
    initialValues: Record<string, unknown>
    submitLabel: React.ReactNode
    onSubmit: (values: Record<string, unknown>) => Promise<void>
  }
  function CrudFormStub({ fields, initialValues, submitLabel, onSubmit }: StubProps) {
    const [values, setValues] = ReactModule.useState<Record<string, unknown>>({ ...initialValues, ...presetFormValues })
    return (
      <div>
        {fields
          .filter((field) => field.id === 'files' && typeof field.component === 'function')
          .map((field) => (
            <div key={field.id}>
              {field.component!({
                id: field.id,
                value: values[field.id],
                disabled: false,
                setValue: (next: unknown) => setValues((prev) => ({ ...prev, [field.id]: next })),
              })}
            </div>
          ))}
        <button type="button" onClick={() => { void onSubmit(values).catch(() => undefined) }}>
          {submitLabel}
        </button>
      </div>
    )
  }
  return { CrudForm: CrudFormStub }
})

const REJECTION = 'Executable file types are not allowed as attachments.'

type PostedUpload = { fileName: string; recordId: string; tags: string | null; assignments: string | null }

function createServer() {
  const posted: PostedUpload[] = []
  let libraryListCalls = 0
  const apiCall = jest.fn(async (url: string, init?: { method?: string; body?: FormData | string }) => {
    if (url === '/api/auth/feature-check') {
      return { ok: true, status: 200, result: { granted: ['attachments.manage'] } }
    }
    if (url.startsWith('/api/attachments/library')) {
      libraryListCalls += 1
      return { ok: true, status: 200, result: { items: [], total: 0, totalPages: 1, partitions: [], availableTags: [] } }
    }
    if (url === '/api/attachments' && init?.method === 'POST' && init.body instanceof FormData) {
      const file = init.body.get('file') as File
      posted.push({
        fileName: file.name,
        recordId: String(init.body.get('recordId')),
        tags: init.body.get('tags') as string | null,
        assignments: init.body.get('assignments') as string | null,
      })
      if (file.name.endsWith('.exe')) return { ok: false, status: 400, result: { error: REJECTION } }
      return { ok: true, status: 200, result: { ok: true, item: { id: `att-${posted.length}` } } }
    }
    return { ok: true, status: 200, result: {} }
  })
  return { apiCall, posted, libraryListCalls: () => libraryListCalls }
}

let server = createServer()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: [string, { method?: string; body?: FormData | string }?]) => server.apiCall(...args),
}))

function textFile(name: string): File {
  return new File([`harmless text for ${name}`], name, { type: 'text/plain' })
}

async function openUploadDialog(names: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AttachmentLibrary />
    </QueryClientProvider>,
  )
  const actions = await screen.findByTestId('library-actions')
  const openButton = await waitFor(() => {
    const button = actions.querySelector('button')
    if (!button) throw new Error('upload action not rendered yet')
    return button
  })
  fireEvent.click(openButton)
  const dialog = await screen.findByRole('dialog')
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: names.map(textFile) } })
  for (const name of names) {
    expect(await screen.findByText(name)).toBeInTheDocument()
  }
  return dialog
}

function submitButton(dialog: HTMLElement): HTMLElement {
  const buttons = Array.from(dialog.querySelectorAll('button'))
  const button = buttons.find((entry) => entry.textContent === 'Upload')
  if (!button) throw new Error('submit button not found')
  return button
}

async function submitAndSettle(dialog: HTMLElement) {
  await act(async () => {
    fireEvent.click(submitButton(dialog))
  })
  await waitFor(() => expect(submitButton(dialog)).toBeInTheDocument())
}

function postedNames(): string[] {
  return server.posted.map((entry) => entry.fileName)
}

describe('AttachmentLibrary multi-file upload (#6397)', () => {
  beforeEach(() => {
    server = createServer()
    presetFormValues = {}
    flashMock.mockReset()
  })

  it('uploads every file, refreshes the library and closes the dialog when all succeed', async () => {
    const dialog = await openUploadDialog(['ok-a.txt', 'ok-b.txt', 'ok-c.txt'])
    const listCallsBefore = server.libraryListCalls()

    await act(async () => {
      fireEvent.click(submitButton(dialog))
    })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(postedNames()).toEqual(['ok-a.txt', 'ok-b.txt', 'ok-c.txt'])
    expect(server.libraryListCalls()).toBeGreaterThan(listCallsBefore)
    expect(flashMock).toHaveBeenCalledWith('Attachment uploaded.', 'success')
  })

  it('keeps every file queued when the first file is rejected', async () => {
    const dialog = await openUploadDialog(['first-blocked.exe', 'first-b.txt', 'first-c.txt'])

    await submitAndSettle(dialog)
    await submitAndSettle(dialog)

    expect(postedNames()).toEqual(['first-blocked.exe', 'first-blocked.exe'])
    expect(screen.getByText('first-blocked.exe')).toBeInTheDocument()
    expect(screen.getByText('first-b.txt')).toBeInTheDocument()
    expect(screen.getByText('first-c.txt')).toBeInTheDocument()
    expect(flashMock).toHaveBeenCalledWith(REJECTION, 'error')
  })

  it('refreshes after a rejected middle file and retries only the failed and unattempted files', async () => {
    presetFormValues = {
      tags: ['scout-tag'],
      assignments: [{ type: 'scout:probe', id: 'rec-6397', href: '', label: '' }],
    }
    const dialog = await openUploadDialog(['scout-first.txt', 'scout-blocked.exe', 'scout-last.txt'])
    const listCallsBefore = server.libraryListCalls()

    await submitAndSettle(dialog)

    expect(postedNames()).toEqual(['scout-first.txt', 'scout-blocked.exe'])
    await waitFor(() => expect(server.libraryListCalls()).toBeGreaterThan(listCallsBefore))
    expect(flashMock).toHaveBeenCalledWith(REJECTION, 'error')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText('scout-first.txt')).toBeNull()
    expect(screen.getByText('scout-blocked.exe')).toBeInTheDocument()
    expect(screen.getByText('scout-last.txt')).toBeInTheDocument()

    await submitAndSettle(dialog)

    expect(postedNames()).toEqual(['scout-first.txt', 'scout-blocked.exe', 'scout-blocked.exe'])
    expect(postedNames().filter((name) => name === 'scout-first.txt')).toHaveLength(1)

    const blockedRow = screen.getByText('scout-blocked.exe').closest('div.rounded')
    fireEvent.click(blockedRow!.querySelector('button')!)
    await waitFor(() => expect(screen.queryByText('scout-blocked.exe')).toBeNull())
    await act(async () => {
      fireEvent.click(submitButton(dialog))
    })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(postedNames()).toEqual(['scout-first.txt', 'scout-blocked.exe', 'scout-blocked.exe', 'scout-last.txt'])
    for (const upload of server.posted) {
      expect(JSON.parse(upload.tags ?? '[]')).toEqual(['scout-tag'])
      expect(JSON.parse(upload.assignments ?? '[]')).toEqual([{ type: 'scout:probe', id: 'rec-6397' }])
    }
    expect(flashMock).toHaveBeenCalledWith('Attachment uploaded.', 'success')
  })

  it('retries only the rejected last file after the others were saved', async () => {
    const dialog = await openUploadDialog(['last-a.txt', 'last-b.txt', 'last-blocked.exe'])

    await submitAndSettle(dialog)

    expect(postedNames()).toEqual(['last-a.txt', 'last-b.txt', 'last-blocked.exe'])
    expect(screen.queryByText('last-a.txt')).toBeNull()
    expect(screen.queryByText('last-b.txt')).toBeNull()
    expect(screen.getByText('last-blocked.exe')).toBeInTheDocument()

    await submitAndSettle(dialog)

    expect(postedNames()).toEqual(['last-a.txt', 'last-b.txt', 'last-blocked.exe', 'last-blocked.exe'])
  })
})
