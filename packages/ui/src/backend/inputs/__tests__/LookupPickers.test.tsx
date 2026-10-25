/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { LookupMultiPicker, LookupSinglePicker } from '../LookupPickers'
import { LookupLoadError, type LookupSource } from '../lookupSources'

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

describe('LookupPickers load failures', () => {
  it('shows an inline message when the options cannot be loaded', async () => {
    const failingSource: LookupSource = {
      id: 'offline',
      search: jest.fn().mockRejectedValue(new LookupLoadError('failed', '/api/example')),
      resolve: jest.fn().mockResolvedValue([]),
    }
    renderWithProviders(<LookupMultiPicker source={failingSource} value={[]} onChange={() => undefined} />)
    fireEvent.focus(screen.getByRole('textbox'))

    expect(await screen.findByTestId('lookup-picker-failure')).toHaveTextContent('Could not load options. Try again.')
  })

  it('tells the user when access to the options is forbidden', async () => {
    const forbiddenSource: LookupSource = {
      id: 'forbidden',
      search: jest.fn().mockResolvedValue([]),
      resolve: jest.fn().mockRejectedValue(new LookupLoadError('forbidden', '/api/example')),
    }
    renderWithProviders(<LookupMultiPicker source={forbiddenSource} value={['cat-1']} onChange={() => undefined} />)

    expect(await screen.findByTestId('lookup-picker-failure')).toHaveTextContent(
      'You do not have permission to load these options.',
    )
  })

  it('clears the message once a later load succeeds', async () => {
    const search = jest
      .fn()
      .mockRejectedValueOnce(new LookupLoadError('failed', '/api/example'))
      .mockResolvedValue(options)
    const flakySource: LookupSource = { id: 'flaky', search, resolve: jest.fn().mockResolvedValue([]) }
    renderWithProviders(<LookupMultiPicker source={flakySource} value={[]} onChange={() => undefined} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    await screen.findByTestId('lookup-picker-failure')

    fireEvent.change(input, { target: { value: 'Cat' } })

    expect(await screen.findByRole('button', { name: /Category One/ })).toBeInTheDocument()
    expect(screen.queryByTestId('lookup-picker-failure')).not.toBeInTheDocument()
  })

  it('keeps the raw id and shows the failure when a single picker cannot resolve its label', async () => {
    const failingSource: LookupSource = {
      id: 'single',
      search: jest.fn().mockResolvedValue([]),
      resolve: jest.fn().mockRejectedValue(new LookupLoadError('forbidden', '/api/example')),
    }
    renderWithProviders(<LookupSinglePicker source={failingSource} value="cat-1" onChange={() => undefined} />)

    expect(await screen.findByTestId('lookup-picker-failure')).toHaveTextContent(
      'You do not have permission to load these options.',
    )
  })
})
