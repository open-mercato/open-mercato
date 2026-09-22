/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))

import { DealCompaniesSelector, DealPeopleSelector } from '../DealForm'

const DEBOUNCE_SETTLE_MS = 400

async function settleDebounce() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_SETTLE_MS))
  })
}

describe('deal association selectors', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    readApiResultOrThrowMock.mockReset()
    apiCallMock.mockResolvedValue({
      ok: true,
      result: {
        items: [{ id: 'person-1', displayName: 'Ada Lovelace', primaryEmail: 'ada@example.com' }],
        totalPages: 1,
      },
    })
  })

  it('issues no lookup request while the search input is empty', async () => {
    renderWithProviders(
      <>
        <DealPeopleSelector value={[]} onChange={() => {}} />
        <DealCompaniesSelector value={[]} onChange={() => {}} />
      </>,
    )

    await settleDebounce()

    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('searches only after the user types and stops again when the input is cleared', async () => {
    renderWithProviders(<DealPeopleSelector value={[]} onChange={() => {}} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'ada' } })

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledTimes(1)
    })
    expect(apiCallMock).toHaveBeenCalledWith(expect.stringContaining('search=ada'))
    await screen.findByRole('button', { name: 'Ada Lovelace' })

    fireEvent.change(input, { target: { value: '   ' } })
    await settleDebounce()

    expect(apiCallMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Ada Lovelace' })).toBeNull()
  })

  it('still prefetches an unfiltered page when a host opts in with minQueryLength 0', async () => {
    renderWithProviders(<DealPeopleSelector value={[]} onChange={() => {}} minQueryLength={0} />)

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledTimes(1)
    })
    expect(apiCallMock).toHaveBeenCalledWith(expect.not.stringContaining('search='))
  })
})
