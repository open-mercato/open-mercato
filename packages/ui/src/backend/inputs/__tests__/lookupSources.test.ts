import { readApiResultOrThrow } from '../../utils/apiCall'
import { categoryLookupSource, tagLookupSource } from '../lookupSources'

jest.mock('../../utils/apiCall', () => ({
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

  it('resolves selected ids without issuing a request for an empty list', async () => {
    expect(await categoryLookupSource.resolve([])).toEqual([])
    expect(readMock).not.toHaveBeenCalled()
  })

  it('resolves tags by filtering the tag list to the wanted ids', async () => {
    readMock.mockResolvedValue({ items: [{ id: 'tag-1', label: 'Sale' }, { id: 'tag-2', label: 'New' }] })
    expect(await tagLookupSource.resolve(['tag-2'])).toEqual([{ value: 'tag-2', label: 'New' }])
  })

  it('degrades to no options when the catalog endpoint fails', async () => {
    readMock.mockRejectedValue(new Error('offline'))
    expect(await tagLookupSource.search('x')).toEqual([])
  })
})
