/** @jest-environment jsdom */
import * as React from 'react'
import { render, waitFor } from '@testing-library/react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useUserDisplayNames } from '../backend/components/useUserDisplayNames'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

const readApiResultOrThrowMock = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>

function Harness({ userIds }: { userIds: string[] }) {
  const names = useUserDisplayNames(userIds)
  return <span data-testid="resolved-count">{Object.keys(names).length}</span>
}

describe('useUserDisplayNames', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
  })

  it('loads every user id in batches of 100', async () => {
    const userIds = Array.from({ length: 101 }, (_, index) => `user-${index}`)
    readApiResultOrThrowMock.mockImplementation(async (url) => {
      const ids = new URL(String(url), 'https://example.test').searchParams.get('ids')?.split(',') ?? []
      return { items: ids.map((id) => ({ id, displayName: id })) }
    })

    const rendered = render(<Harness userIds={userIds} />)

    await waitFor(() => expect(rendered.getByTestId('resolved-count')).toHaveTextContent('101'))
    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2)
    expect(String(readApiResultOrThrowMock.mock.calls[0]?.[0]).split(',')).toHaveLength(100)
  })
})
