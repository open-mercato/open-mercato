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
        children: 'in transit',
      },
    })
  })
})
