/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { EntryCard } from '../components/EntryCard'
import type { GalleryEntry } from '../types'

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const copy = jest.fn<Promise<void>, [string]>()
const selectedCode = 'import { Button } from "@open-mercato/ui/primitives/button"\n\n<Button variant="outline">Save</Button>'
const entry: GalleryEntry = {
  id: 'clipboard-specimen',
  title: 'Clipboard specimen',
  importPath: '@open-mercato/ui/primitives/button',
  variants: [
    { id: 'first', title: 'First', render: () => <span>First specimen</span>, code: '<Button>First</Button>' },
    { id: 'selected', title: 'Selected', render: () => <span>Selected specimen</span>, code: selectedCode },
  ],
}

function mountSelectedExample() {
  return render(<I18nProvider locale="en" dict={{}}><EntryCard entry={entry} /></I18nProvider>)
}

beforeEach(() => {
  jest.clearAllMocks()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
})

afterAll(() => {
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  else Reflect.deleteProperty(navigator, 'clipboard')
})

describe('native gallery snippet copy', () => {
  it('copies the selected variant with exact newlines from the preview without a collapsible section', async () => {
    copy.mockResolvedValueOnce()
    const { container } = mountSelectedExample()
    expect(container.querySelector('details')).toBeNull()
    fireEvent.click(within(document.getElementById('gallery-variant-clipboard-specimen-selected')!).getByRole('button', { name: 'Copy code' }))
    await waitFor(() => expect(flash).toHaveBeenCalledWith('Snippet copied to clipboard', 'success'))
    expect(copy).toHaveBeenCalledTimes(1)
    expect(copy).toHaveBeenCalledWith(selectedCode)
  })

  it('switches between preview and code without an accordion', () => {
    mountSelectedExample()
    const example = within(document.getElementById('gallery-variant-clipboard-specimen-selected')!)
    expect(example.getByText('Selected specimen')).toBeVisible()
    fireEvent.click(example.getByRole('tab', { name: 'Code', exact: true }))
    expect(example.getByRole('tabpanel')).toHaveTextContent('import { Button }')
    expect(example.queryByText('Selected specimen')).not.toBeInTheDocument()
    fireEvent.click(example.getByRole('tab', { name: 'Preview', exact: true }))
    expect(example.getByText('Selected specimen')).toBeVisible()
  })

  it('reports a rejected clipboard write without claiming success', async () => {
    copy.mockRejectedValueOnce(new DOMException('Clipboard blocked', 'NotAllowedError'))
    mountSelectedExample()
    fireEvent.click(within(document.getElementById('gallery-variant-clipboard-specimen-selected')!).getByRole('button', { name: 'Copy code' }))
    await waitFor(() => expect(flash).toHaveBeenCalledWith('Could not copy the snippet', 'error'))
    expect(flash).toHaveBeenCalledTimes(1)
  })
})
