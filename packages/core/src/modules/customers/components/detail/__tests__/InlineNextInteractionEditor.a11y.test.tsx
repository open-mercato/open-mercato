/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { InlineNextInteractionEditor } from '../InlineEditors'

function renderEditor() {
  return renderWithProviders(
    <InlineNextInteractionEditor
      label="Next interaction"
      valueAt={null}
      valueName={null}
      valueRefId={null}
      valueIcon={null}
      valueColor={null}
      emptyLabel="No next interaction"
      onSave={jest.fn()}
    />,
    { dict: {} },
  )
}

describe('InlineNextInteractionEditor trigger accessibility and touch reachability (#5947)', () => {
  it('exposes an accessible name on its edit trigger', () => {
    renderEditor()

    const trigger = screen.getByRole('button', { name: 'Edit' })
    expect(trigger).toHaveAttribute('aria-label', 'Edit')
  })

  it('relabels the trigger to Cancel while editing', () => {
    renderEditor()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    })

    const labelledTriggers = screen
      .getAllByRole('button', { name: 'Cancel' })
      .filter((button) => button.getAttribute('aria-label') === 'Cancel')
    expect(labelledTriggers).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('reveals the trigger on coarse-pointer devices that never hover', () => {
    renderEditor()

    // This editor sits beside the shared inline editors on the person detail page, so it
    // has to share their coarse-pointer reveal or it stays invisible on touch.
    expect(screen.getByRole('button', { name: 'Edit' }).className).toContain(
      '[@media(hover:none)]:opacity-100',
    )
  })
})
