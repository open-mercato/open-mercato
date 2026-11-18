/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { PipelineFilterPopover } from '../PipelineFilterPopover'
import { FilterPopoverShell } from '../FilterPopoverShell'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/shared/lib/i18n/translate', () => ({
  translateWithFallback: (_translate: unknown, _key: string, fallback: string) => fallback,
}))

const pipelines = Array.from({ length: 30 }, (_, index) => ({
  id: `pipeline-${index}`,
  name: `Pipeline ${index + 1}`,
}))

async function openFilter(onApply = jest.fn()) {
  render(<PipelineFilterPopover pipelines={pipelines} selectedPipelineId={null} onApply={onApply} />)
  fireEvent.click(screen.getByRole('button', { name: /^Pipeline:/ }))
  return screen.findByRole('dialog')
}

describe('PipelineFilterPopover', () => {
  it('bounds a long list to the available popover height while retaining its actions', async () => {
    const onApply = jest.fn()
    const dialog = await openFilter(onApply)
    const lastOption = within(dialog).getByRole('radio', { name: 'Pipeline 30', exact: true })
    const body = lastOption.parentElement
    const shell = body?.parentElement

    expect(shell).toHaveStyle({ maxHeight: 'var(--radix-popover-content-available-height)' })
    expect(body).toHaveClass('min-h-0', 'overflow-y-auto')
    expect(shell?.firstElementChild).toHaveClass('shrink-0')
    expect(shell?.lastElementChild).toHaveClass('shrink-0')
    expect(within(dialog).getAllByRole('radio')).toHaveLength(31)

    fireEvent.click(lastOption)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply', exact: true }))

    expect(onApply).toHaveBeenCalledWith('pipeline-29')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('discards a draft selection on Escape', async () => {
    const onApply = jest.fn()
    const dialog = await openFilter(onApply)
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Pipeline 30', exact: true }))
    fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(onApply).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Pipeline:/ }))
    expect(await screen.findByRole('radio', { name: 'Pipeline 30', exact: true })).toHaveAttribute('aria-checked', 'false')
  })

  it.each(['ctrlKey', 'metaKey'])('applies a selection using %s+Enter', async (modifier) => {
    const onApply = jest.fn()
    const dialog = await openFilter(onApply)
    const option = within(dialog).getByRole('radio', { name: 'Pipeline 30', exact: true })
    fireEvent.click(option)
    fireEvent.keyDown(option, { key: 'Enter', [modifier]: true })

    expect(onApply).toHaveBeenCalledWith('pipeline-29')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('retains scrolling when a filter customizes its body classes', () => {
    render(
      <FilterPopoverShell title="Custom filter" bodyClassName="bg-muted p-4" onClose={jest.fn()} onCancel={jest.fn()} onApply={jest.fn()}>
        <span>Custom body</span>
      </FilterPopoverShell>,
    )
    expect(screen.getByText('Custom body').parentElement).toHaveClass('min-h-0', 'overflow-y-auto', 'bg-muted', 'p-4')
  })
})
