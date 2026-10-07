/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { LookupMultiPicker } from '../LookupPickers'
import type { LookupSource } from '../lookupSources'

const options = [
  { value: 'cat-1', label: 'Category One' },
  { value: 'cat-2', label: 'Category Two' },
]

const source: LookupSource = {
  id: 'test',
  search: jest.fn().mockResolvedValue(options),
  resolve: jest.fn().mockResolvedValue([]),
}

function Harness() {
  const [value, setValue] = React.useState<string[]>([])
  return <LookupMultiPicker source={source} value={value} onChange={setValue} />
}

describe('LookupMultiPicker', () => {
  it('closes the suggestion list after a pick', async () => {
    renderWithProviders(<Harness />)
    fireEvent.focus(screen.getByRole('textbox'))
    fireEvent.click(await screen.findByRole('button', { name: /Category One/ }))

    expect(screen.queryByRole('button', { name: /Category Two/ })).not.toBeInTheDocument()
  })
})
