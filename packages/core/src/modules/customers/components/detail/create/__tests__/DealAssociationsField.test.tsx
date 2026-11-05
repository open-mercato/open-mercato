/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DealAssociationsField } from '../DealAssociationsField'

const mockSearchPeople = jest.fn()
const mockFetchPeopleByIds = jest.fn()
const mockSearchCompanies = jest.fn()
const mockFetchCompaniesByIds = jest.fn()

jest.mock('../../DealForm', () => ({
  useDealAssociationLookups: () => ({
    searchPeople: mockSearchPeople,
    fetchPeopleByIds: mockFetchPeopleByIds,
    searchCompanies: mockSearchCompanies,
    fetchCompaniesByIds: mockFetchCompaniesByIds,
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

const labels = {
  placeholder: 'Search people…',
  empty: 'No people linked yet.',
  loading: 'Searching people…',
  noResults: 'No people match your search.',
  remove: 'Remove',
  error: 'Failed to load people.',
}

const ALICE = { id: 'p1', label: 'Alice Smith', subtitle: 'alice@example.com' }

beforeEach(() => {
  jest.clearAllMocks()
  mockSearchPeople.mockImplementation(async (query: string) => (query ? [ALICE] : []))
  mockFetchPeopleByIds.mockImplementation(async (ids: string[]) =>
    ids.map((id) => (id === 'p1' ? ALICE : { id, label: id })),
  )
})

describe('DealAssociationsField', () => {
  it('adds a person when a search suggestion is clicked', async () => {
    const onChange = jest.fn()
    render(<DealAssociationsField kind="people" value={[]} onChange={onChange} labels={labels} />)

    fireEvent.change(screen.getByPlaceholderText('Search people…'), { target: { value: 'Ali' } })

    const suggestion = await screen.findByRole('button', { name: 'Alice Smith' })
    fireEvent.click(suggestion)

    expect(onChange).toHaveBeenCalledWith(['p1'])
  })

  it('hydrates and removes a selected chip via its remove control', async () => {
    const onChange = jest.fn()
    render(<DealAssociationsField kind="people" value={['p1']} onChange={onChange} labels={labels} />)

    const removeButton = await screen.findByRole('button', { name: 'Remove Alice Smith' })
    fireEvent.click(removeButton)

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('removes the last chip on Backspace when the search box is empty', async () => {
    const onChange = jest.fn()
    render(<DealAssociationsField kind="people" value={['p1']} onChange={onChange} labels={labels} />)

    await screen.findByRole('button', { name: 'Remove Alice Smith' })
    fireEvent.keyDown(screen.getByPlaceholderText('Search people…'), { key: 'Backspace' })

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('does not offer an already-selected person as a suggestion', async () => {
    const onChange = jest.fn()
    render(<DealAssociationsField kind="people" value={['p1']} onChange={onChange} labels={labels} />)

    await screen.findByRole('button', { name: 'Remove Alice Smith' })
    fireEvent.change(screen.getByPlaceholderText('Search people…'), { target: { value: 'Ali' } })

    await waitFor(() => expect(screen.getByText('No people match your search.')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Alice Smith' })).not.toBeInTheDocument()
  })
})
