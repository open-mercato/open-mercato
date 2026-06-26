import { isValidElement } from 'react'
import widget from '../tracking-status-badge/widget'

describe('tracking status badge widget', () => {
  it('renders a React badge instead of a raw HTML string', () => {
    const cell = widget.columns[0]?.cell
    expect(cell).toBeDefined()

    const rendered = cell?.({ getValue: () => 'in_transit' })
    expect(isValidElement(rendered)).toBe(true)
    expect(rendered).toMatchObject({
      props: {
        status: 'in_transit',
      },
    })
  })

  it('renders nothing for empty or non-string values', () => {
    const cell = widget.columns[0]?.cell
    expect(cell?.({ getValue: () => '' })).toBeNull()
    expect(cell?.({ getValue: () => null })).toBeNull()
  })
})
