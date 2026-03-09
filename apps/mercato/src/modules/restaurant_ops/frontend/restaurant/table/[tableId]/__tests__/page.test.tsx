import React from 'react'

const notFound = jest.fn(() => {
  throw new Error('NOT_FOUND')
})

jest.mock('next/navigation', () => ({
  notFound: () => notFound(),
}))

const demoMock = jest.fn(() => React.createElement('div', null, 'RestaurantOpsDemo'))

jest.mock('@/modules/restaurant_ops/components/RestaurantOpsDemo', () => ({
  RestaurantOpsDemo: (props: unknown) => demoMock(props),
}))

import RestaurantTablePage from '../page'

describe('restaurant table page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the table experience for a valid table id', async () => {
    const element = await RestaurantTablePage({ params: Promise.resolve({ tableId: 't12' }) })
    expect(element).toBeTruthy()
    expect(notFound).not.toHaveBeenCalled()
    expect(demoMock).toHaveBeenCalledWith(expect.objectContaining({ initialTableId: 't12' }), undefined)
  })

  it('fails closed for an unknown table id', async () => {
    await expect(
      RestaurantTablePage({ params: Promise.resolve({ tableId: 'mesa-inexistente' }) })
    ).rejects.toThrow('NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })
})
