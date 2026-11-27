/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { FieldRow } from '../FieldRow'
import enDict from '../../../../../../i18n/en.json'

jest.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: jest.fn() }),
}))

const label = 'Text source with a deliberately long descriptive label for source switching and layout wrapping'

function renderRow(canMoveUp = true) {
  const callbacks = { onSelect: jest.fn(), onMove: jest.fn(), onDelete: jest.fn() }
  render(
    <FieldRow
      fieldKey="text_source"
      node={{ type: 'string', 'x-om-type': 'text', 'x-om-label': { en: label } }}
      isSelected={false}
      canMoveUp={canMoveUp}
      canMoveDown
      activeLocale="en"
      t={(key) => enDict[key as keyof typeof enDict] ?? key}
      {...callbacks}
    />,
  )
  return callbacks
}

describe('FieldRow long label layout', () => {
  it('keeps selection, move and delete callbacks separate with a long label', () => {
    const callbacks = renderRow()

    fireEvent.click(screen.getByRole('button', { name: /Text source with/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Move field up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move field down' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete field' }))

    expect(callbacks.onSelect).toHaveBeenCalledTimes(1)
    expect(callbacks.onSelect).toHaveBeenCalledWith('text_source')
    expect(callbacks.onMove.mock.calls).toEqual([['text_source', 'up'], ['text_source', 'down']])
    expect(callbacks.onDelete).toHaveBeenCalledWith('text_source')
  })

  it('preserves a disabled move control at a section boundary', () => {
    const callbacks = renderRow(false)

    const moveUp = screen.getByRole('button', { name: 'Move field up' })
    expect(moveUp).toBeDisabled()
    fireEvent.click(moveUp)
    expect(callbacks.onMove).not.toHaveBeenCalled()
  })
})
