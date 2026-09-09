/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render } from '@testing-library/react'

type LoadingShell = React.ComponentType<{ error?: Error | null; retry?: () => void }>

const capturedShells = new Map<string, LoadingShell>()

jest.mock('next/dynamic', () => (_loader: unknown, options?: { loading?: LoadingShell }) => {
  if (options?.loading) capturedShells.set(options.loading.name, options.loading)
  return () => null
})

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({ DataTable: () => null }))
jest.mock('@open-mercato/ui/backend/RowActions', () => ({ RowActions: () => null }))

import '../backend/documents/DocumentsPageClient'
import '../backend/documents/templates/TemplatesPageClient'
import '../backend/documents/[id]/VersionHistoryPanel'

const SHELL_NAMES = [
  'NewFromTemplateDialogLoading',
  'TemplateEditorDialogLoading',
  'VersionPreviewDialogLoading',
]

describe('dynamic-import dialog loading shells', () => {
  it('registers a loading shell for every lazily imported dialog', () => {
    for (const name of SHELL_NAMES) expect(capturedShells.get(name)).toBeDefined()
  })

  it.each(SHELL_NAMES)('%s closes on Escape while the chunk is still loading', (name) => {
    const Shell = capturedShells.get(name)!
    render(<Shell />)

    expect(document.querySelector('[data-dialog-content]')).not.toBeNull()

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

    // A chunk invalidated by a deploy never resolves, so a shell that ignores
    // Escape traps the user in a modal with no way out but a page reload.
    expect(document.querySelector('[data-dialog-content]')).toBeNull()
  })

  it.each(SHELL_NAMES)('%s exposes an explicit close control once the chunk has failed', (name) => {
    const Shell = capturedShells.get(name)!
    const { container } = render(<Shell error={new Error('chunk load failed')} retry={jest.fn()} />)

    expect(container.ownerDocument.querySelector('[data-dialog-content] button[type="button"]')).not.toBeNull()

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

    expect(document.querySelector('[data-dialog-content]')).toBeNull()
  })
})
