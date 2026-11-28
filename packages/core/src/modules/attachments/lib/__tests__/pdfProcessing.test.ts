/** @jest-environment node */

const mockReadFile = jest.fn()
const mockGetDocument = jest.fn()

jest.mock('fs/promises', () => ({
  __esModule: true,
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
}))

jest.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: (...args: unknown[]) => mockGetDocument(...args),
}), { virtual: true })

type FakePageSpec = { text: string }

function createFakePdf(pages: FakePageSpec[]) {
  const requestedPages: number[] = []
  const renderedPages: number[] = []
  const pdfDocument = {
    numPages: pages.length,
    canvasFactory: {
      create: () => ({ canvas: { toBuffer: () => Buffer.from('png') }, context: {} }),
      destroy: () => undefined,
    },
    getPage: async (pageNumber: number) => {
      requestedPages.push(pageNumber)
      return {
        cleanup: () => undefined,
        getTextContent: async () => ({ items: [{ str: pages[pageNumber - 1].text }] }),
        getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 100 * scale }),
        render: () => {
          renderedPages.push(pageNumber)
          return { promise: Promise.resolve() }
        },
      }
    },
  }
  mockGetDocument.mockReturnValue({ promise: Promise.resolve(pdfDocument), destroy: async () => undefined })
  return { requestedPages, renderedPages }
}

describe('preparePdfPagesForOcr page selection', () => {
  const previousMaxPages = process.env.OM_ATTACHMENT_OCR_MAX_PAGES

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_ATTACHMENT_OCR_MAX_PAGES
    mockReadFile.mockResolvedValue(Buffer.from('%PDF'))
  })

  afterAll(() => {
    if (previousMaxPages === undefined) delete process.env.OM_ATTACHMENT_OCR_MAX_PAGES
    else process.env.OM_ATTACHMENT_OCR_MAX_PAGES = previousMaxPages
  })

  it('processes every page up to the cap by default', async () => {
    const { preparePdfPagesForOcr } = await import('../pdfProcessing')
    const fake = createFakePdf([{ text: 'one' }, { text: '' }, { text: 'three' }])
    const result = await preparePdfPagesForOcr('/tmp/doc.pdf')
    expect(fake.requestedPages).toEqual([1, 2, 3])
    expect(fake.renderedPages).toEqual([2])
    expect(result.pages.map((page) => [page.pageNumber, page.extractedText, page.imageBuffer !== null])).toEqual([
      [1, 'one', false],
      [2, null, true],
      [3, 'three', false],
    ])
  })

  it('processes only the selected, in-range pages, capped by OM_ATTACHMENT_OCR_MAX_PAGES', async () => {
    process.env.OM_ATTACHMENT_OCR_MAX_PAGES = '2'
    const { preparePdfPagesForOcr } = await import('../pdfProcessing')
    const fake = createFakePdf([{ text: 'one' }, { text: '' }, { text: 'three' }, { text: '' }])
    const result = await preparePdfPagesForOcr('/tmp/doc.pdf', { pageNumbers: [4, 0, 2, 9, 2, 3] })
    expect(fake.requestedPages).toEqual([2, 3])
    expect(result.pages.map((page) => page.pageNumber)).toEqual([2, 3])
  })

  it('renders pages with a sparse text layer when alwaysRender is set', async () => {
    const { preparePdfPagesForOcr } = await import('../pdfProcessing')
    const fake = createFakePdf([{ text: 'one' }, { text: '7' }])
    const result = await preparePdfPagesForOcr('/tmp/doc.pdf', { pageNumbers: [2], alwaysRender: true })
    expect(fake.renderedPages).toEqual([2])
    expect(result.pages).toEqual([{ pageNumber: 2, extractedText: null, imageBuffer: Buffer.from('png') }])
  })
})
