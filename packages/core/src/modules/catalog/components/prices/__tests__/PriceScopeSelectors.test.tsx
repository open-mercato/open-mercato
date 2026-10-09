/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { PricePriceKindSelect, PriceChannelSelect } from '../PriceScopeSelectors'

type ComboboxProps = { resolveLabel?: (id: string) => Promise<string> }

const capturedProps: ComboboxProps[] = []
jest.mock('@open-mercato/ui/backend/inputs/ComboboxInput', () => ({
  ComboboxInput: (props: ComboboxProps) => {
    capturedProps.push(props)
    return null
  },
}))

const mockReadApiResult = jest.fn<Promise<{ items: Array<Record<string, unknown>> }>, [string]>()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (url: string) => mockReadApiResult(url),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

const SALE = { id: '04fa3298-18b3-472a-a1ce-140a6667c10d', title: 'Sale', code: 'sale' }
const REGULAR = { id: '69725a8d-576e-4fc4-ac7f-30cce9f39bb7', title: 'Regular', code: 'regular' }

function latestResolveLabel(): (id: string) => Promise<string> {
  const resolver = capturedProps[capturedProps.length - 1]?.resolveLabel
  if (!resolver) throw new Error('[internal] resolveLabel was not passed to ComboboxInput')
  return resolver
}

describe('PriceScopeSelectors label resolution', () => {
  beforeEach(() => {
    capturedProps.length = 0
    mockReadApiResult.mockReset()
  })

  it('resolves a saved price kind through the ids filter the price-kinds route honors', async () => {
    mockReadApiResult.mockImplementation(async (url: string) =>
      url.includes(`ids=${REGULAR.id}`) ? { items: [REGULAR] } : { items: [SALE, REGULAR] },
    )
    render(<PricePriceKindSelect value={REGULAR.id} onChange={() => undefined} />)

    await expect(latestResolveLabel()(REGULAR.id)).resolves.toBe('Regular (regular)')
    expect(mockReadApiResult.mock.calls[0][0]).toContain(`ids=${REGULAR.id}`)
  })

  it('never labels a value with a different record when the lookup ignores the id filter', async () => {
    mockReadApiResult.mockResolvedValue({ items: [{ id: 'other-channel', name: 'Other channel', code: 'other' }] })
    render(<PriceChannelSelect value="wanted-channel" onChange={() => undefined} />)

    await expect(latestResolveLabel()('wanted-channel')).resolves.toBe('wanted-channel')
  })
})
