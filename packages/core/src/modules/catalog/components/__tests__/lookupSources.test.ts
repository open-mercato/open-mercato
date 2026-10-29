import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { categoryLookupSource, productLookupSource, tagLookupSource } from '../lookupSources'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

const readMock = readApiResultOrThrow as jest.Mock

describe('catalog lookup sources', () => {
  beforeEach(() => readMock.mockReset())

  it('searches categories through the manage view and labels them by path', async () => {
    readMock.mockResolvedValue({ items: [{ id: 'cat-1', pathLabel: 'Apparel / Shoes', name: 'Shoes' }, { name: 'no id' }] })
    const options = await categoryLookupSource.search('sho')
    expect(options).toEqual([{ value: 'cat-1', label: 'Apparel / Shoes' }])
    const url = readMock.mock.calls[0][0] as string
    expect(url).toContain('/api/catalog/categories?')
    expect(url).toContain('view=manage')
    expect(url).toContain('search=sho')
  })

  it('labels products by title with the SKU as description', async () => {
    readMock.mockResolvedValue({ items: [{ id: 'p-1', title: 'Sneaker', sku: 'SNK-1' }] })
    expect(await productLookupSource.search('sne')).toEqual([{ value: 'p-1', label: 'Sneaker', description: 'SNK-1' }])
    expect(readMock.mock.calls[0][0] as string).toContain('/api/catalog/products?')
  })

  it('resolves tags by id through the ids filter instead of listing a page of tags', async () => {
    readMock.mockResolvedValue({ items: [{ id: 'tag-2', label: 'New' }] })
    expect(await tagLookupSource.resolve(['tag-2'])).toEqual([{ value: 'tag-2', label: 'New' }])
    const url = new URL(readMock.mock.calls[0][0] as string, 'http://localhost')
    expect(url.pathname).toBe('/api/catalog/tags')
    expect(url.searchParams.get('ids')).toBe('tag-2')
    expect(Number(url.searchParams.get('pageSize'))).toBeLessThanOrEqual(100)
  })

  it.each([
    ['categories', categoryLookupSource],
    ['products', productLookupSource],
    ['tags', tagLookupSource],
  ])('resolves %s in chunks of at most 100 ids', async (_label, source) => {
    const ids = Array.from({ length: 250 }, (_, index) => `id-${index}`)
    readMock.mockImplementation(async (path: string) => {
      const requested = new URL(path, 'http://localhost').searchParams.get('ids')?.split(',') ?? []
      return { items: requested.map((id) => ({ id, label: id, title: id, name: id })) }
    })
    const options = await source.resolve([...ids, 'id-0'])
    expect(options.map((option) => option.value)).toEqual(ids)
    expect(readMock).toHaveBeenCalledTimes(3)
  })
})
