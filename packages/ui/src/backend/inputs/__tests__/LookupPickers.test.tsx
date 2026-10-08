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

describe('LookupMultiPicker label resolution', () => {
  it('resolves saved ids to labels under StrictMode, where the first lookup is cancelled', async () => {
    const resolve = jest.fn(async (ids: readonly string[]) => options.filter((option) => ids.includes(option.value)))
    const strictSource: LookupSource = { id: 'strict', search: jest.fn().mockResolvedValue([]), resolve }
    renderWithProviders(
      <React.StrictMode>
        <LookupMultiPicker source={strictSource} value={['cat-2']} onChange={() => undefined} />
      </React.StrictMode>,
    )

    expect(await screen.findByText('Category Two')).toBeInTheDocument()
  })

  it('retries ids whose lookup failed', async () => {
    const resolve = jest
      .fn()
      .mockRejectedValueOnce(new Error('[internal] lookup failed'))
      .mockImplementation(async (ids: readonly string[]) => options.filter((option) => ids.includes(option.value)))
    const failingSource: LookupSource = { id: 'failing', search: jest.fn().mockResolvedValue([]), resolve }
    const { rerender } = renderWithProviders(
      <LookupMultiPicker source={failingSource} value={['cat-1']} onChange={() => undefined} />,
    )
    await screen.findByText('cat-1')
    await Promise.resolve()
    rerender(<LookupMultiPicker source={failingSource} value={['cat-1', 'cat-2']} onChange={() => undefined} />)

    expect(await screen.findByText('Category One')).toBeInTheDocument()
    expect(screen.getByText('Category Two')).toBeInTheDocument()
  })
})
