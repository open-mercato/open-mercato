/**
 * @jest-environment jsdom
 *
 * Step 7.2: the "New workflow" template gallery dialog lists seeded templates
 * from GET /api/workflows/templates as cards (icon, translated name and
 * description, category chip) with a "Blank canvas" card first. Selecting a
 * card calls onSelect with the template (or null for blank) and closes the
 * dialog; load failures render a retryable error state; Cmd/Ctrl+Enter
 * selects the active card.
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TemplateGalleryDialog, type WorkflowTemplateGalleryItem } from '../TemplateGalleryDialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? `translated:${key}`,
}))

const apiCallMock = apiCall as jest.Mock

const TEMPLATES: WorkflowTemplateGalleryItem[] = [
  {
    id: 'order-approval',
    nameKey: 'workflows.templates.order-approval.name',
    descriptionKey: 'workflows.templates.order-approval.description',
    category: 'Sales',
    icon: 'check-circle',
    definition: { steps: [], transitions: [] },
  },
  {
    id: 'webhook-integration',
    nameKey: 'workflows.templates.webhook-integration.name',
    descriptionKey: 'workflows.templates.webhook-integration.description',
    category: 'Integrations',
    icon: 'webhook',
    definition: { steps: [], transitions: [] },
  },
]

function mockTemplatesResponse(items: WorkflowTemplateGalleryItem[]) {
  apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { items } })
}

function mockTemplatesFailure() {
  apiCallMock.mockResolvedValue({ ok: false, status: 500, result: { error: 'boom' } })
}

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('TemplateGalleryDialog', () => {
  it('renders the blank-canvas card first followed by one card per fetched template', async () => {
    mockTemplatesResponse(TEMPLATES)
    render(<TemplateGalleryDialog open onOpenChange={jest.fn()} onSelect={jest.fn()} />)

    await waitFor(() => expect(screen.getByTestId('template-card-order-approval')).toBeTruthy())
    expect(apiCallMock).toHaveBeenCalledWith('/api/workflows/templates')

    const cards = screen.getAllByTestId(/^template-card-/)
    expect(cards.map((card) => card.getAttribute('data-testid'))).toEqual([
      'template-card-blank',
      'template-card-order-approval',
      'template-card-webhook-integration',
    ])

    expect(screen.getByText('translated:workflows.templates.order-approval.name')).toBeTruthy()
    expect(screen.getByText('translated:workflows.templates.order-approval.description')).toBeTruthy()
    expect(screen.getByText('Sales')).toBeTruthy()
    expect(screen.getByText('Integrations')).toBeTruthy()
  })

  it('calls onSelect with the chosen template and closes the dialog', async () => {
    mockTemplatesResponse(TEMPLATES)
    const onSelect = jest.fn()
    const onOpenChange = jest.fn()
    render(<TemplateGalleryDialog open onOpenChange={onOpenChange} onSelect={onSelect} />)

    await waitFor(() => expect(screen.getByTestId('template-card-order-approval')).toBeTruthy())
    fireEvent.click(screen.getByTestId('template-card-order-approval'))

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'order-approval' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('calls onSelect with null when the blank-canvas card is chosen', async () => {
    mockTemplatesResponse(TEMPLATES)
    const onSelect = jest.fn()
    const onOpenChange = jest.fn()
    render(<TemplateGalleryDialog open onOpenChange={onOpenChange} onSelect={onSelect} />)

    await waitFor(() => expect(screen.getByTestId('template-card-blank')).toBeTruthy())
    fireEvent.click(screen.getByTestId('template-card-blank'))

    expect(onSelect).toHaveBeenCalledWith(null)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('selects the active card on Cmd+Enter (blank canvas by default)', async () => {
    mockTemplatesResponse(TEMPLATES)
    const onSelect = jest.fn()
    render(<TemplateGalleryDialog open onOpenChange={jest.fn()} onSelect={onSelect} />)

    await waitFor(() => expect(screen.getByTestId('template-card-blank')).toBeTruthy())
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })

    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('renders a retryable error state when the template fetch fails', async () => {
    mockTemplatesFailure()
    render(<TemplateGalleryDialog open onOpenChange={jest.fn()} onSelect={jest.fn()} />)

    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy())
    expect(screen.queryByTestId('template-card-blank')).toBeNull()

    mockTemplatesResponse(TEMPLATES)
    fireEvent.click(screen.getByText('Retry'))

    await waitFor(() => expect(screen.getByTestId('template-card-order-approval')).toBeTruthy())
    expect(apiCallMock).toHaveBeenCalledTimes(2)
  })

  it('opens as a drawer, so the list or canvas behind it stays legible', async () => {
    mockTemplatesResponse(TEMPLATES)
    render(<TemplateGalleryDialog open onOpenChange={jest.fn()} onSelect={jest.fn()} />)

    await waitFor(() => expect(screen.getByTestId('template-card-blank')).toBeTruthy())
    const rail = screen.getByTestId('workflow-template-gallery-drawer')
    expect(rail.getAttribute('data-slot')).toBe('drawer-content')
  })

  it('closes on Escape', async () => {
    mockTemplatesResponse(TEMPLATES)
    const onOpenChange = jest.fn()
    render(<TemplateGalleryDialog open onOpenChange={onOpenChange} onSelect={jest.fn()} />)

    await waitFor(() => expect(screen.getByTestId('template-card-blank')).toBeTruthy())
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
