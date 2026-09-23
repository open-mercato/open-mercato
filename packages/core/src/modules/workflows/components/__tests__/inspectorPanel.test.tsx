/**
 * @jest-environment jsdom
 *
 * The inspector shell — fidelity gap #7.
 *
 * The two variants differ in exactly the property that made the old 1280×675
 * modal unusable: whether the canvas survives underneath. A docked rail renders
 * in the layout flow (no dialog role, no overlay), an overlay renders as a
 * modal. Everything else about the two must stay identical, or a step inspected
 * on a laptop and a step inspected on a desktop stop being the same surface.
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { InspectorPanel } from '../InspectorPanel'

function renderPanel(props: Partial<React.ComponentProps<typeof InspectorPanel>> = {}) {
  const onClose = jest.fn()
  renderWithProviders(
    <InspectorPanel
      open
      onClose={onClose}
      variant="docked"
      title="Edit step"
      typeLabel="User task"
      description="Configure this step."
      recordId="step_approve"
      {...props}
    >
      <button type="button">body content</button>
    </InspectorPanel>,
  )
  return { onClose }
}

describe('InspectorPanel', () => {
  it('docks into the layout instead of covering the canvas', () => {
    renderPanel()

    const panel = screen.getByRole('complementary', { name: 'Edit step' })
    expect(panel).toHaveAttribute('data-variant', 'docked')
    // A dialog would trap focus and block the canvas; the whole point of the
    // rail is that it does neither.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('body content')).toBeInTheDocument()
  })

  it('renders the heading, the type chip and the durable id', () => {
    renderPanel()

    expect(screen.getByRole('heading', { name: 'Edit step' })).toBeInTheDocument()
    expect(screen.getByText('User task')).toBeInTheDocument()
    expect(screen.getByText('step_approve')).toBeInTheDocument()
    expect(screen.getByText('Configure this step.')).toBeInTheDocument()
  })

  it('closes from the close button and from Escape inside the rail', () => {
    const { onClose } = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(screen.getByRole('complementary', { name: 'Edit step' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('renders nothing at all when closed, so the canvas keeps the full row', () => {
    renderPanel({ open: false })

    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.queryByText('body content')).toBeNull()
  })

  it('falls back to a modal drawer where there is no room for a rail', () => {
    renderPanel({ variant: 'overlay' })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.getByText('body content')).toBeInTheDocument()
  })

  it('keeps the same heading vocabulary in both variants', () => {
    renderPanel({ variant: 'overlay' })

    expect(screen.getByText('Edit step')).toBeInTheDocument()
    expect(screen.getByText('User task')).toBeInTheDocument()
    expect(screen.getByText('step_approve')).toBeInTheDocument()
  })
})
