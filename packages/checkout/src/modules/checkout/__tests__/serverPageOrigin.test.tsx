import { headers } from 'next/headers'
import CheckoutTemplatePreviewPage from '../backend/checkout/templates/[id]/preview/page'
import CheckoutPublicPayPage from '../frontend/pay/[slug]/page'

jest.mock('next/headers', () => ({ headers: jest.fn() }))
jest.mock('../components/PayPage', () => ({ PayPage: jest.fn() }))

const mockedHeaders = jest.mocked(headers)
const payload = { title: 'Example checkout' }
const cookie = 'checkout_test=synthetic'
const originalEnv = process.env

const pages = [
  {
    name: 'template preview',
    render: () => CheckoutTemplatePreviewPage({ params: { id: 'example' } }),
    path: '/api/checkout/templates/example/preview',
  },
  {
    name: 'public checkout',
    render: () => CheckoutPublicPayPage({ params: { slug: 'example' } }),
    path: '/api/checkout/pay/example',
  },
  {
    name: 'draft checkout preview',
    render: () => CheckoutPublicPayPage({ params: { slug: 'example' }, searchParams: { preview: 'true' } }),
    path: '/api/checkout/pay/example?preview=true',
  },
]

beforeEach(() => {
  process.env = { ...originalEnv, NODE_ENV: 'production', APP_URL: 'https://example.com/shop/' }
  delete process.env.NEXT_PUBLIC_APP_URL
  mockedHeaders.mockResolvedValue(new Headers({
    host: 'other.example',
    'x-forwarded-host': 'proxy.example',
    'x-forwarded-proto': 'http',
    cookie,
  }))
})

afterEach(() => {
  process.env = originalEnv
  jest.restoreAllMocks()
})

describe.each(pages)('$name', ({ render, path }) => {
  it('loads the configured application subpath with credentials and rejects redirects', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(payload))

    const page = await render()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(`https://example.com/shop${path}`)
    expect(new Headers(options?.headers).get('cookie')).toBe(cookie)
    expect(options).toMatchObject({ redirect: 'error', cache: 'no-store' })
    expect(page.props.initialPayload).toEqual(payload)
  })

  it.each([undefined, 'invalid URL', 'ftp://example.com', 'https://name@example.com'])(
    'skips the server fetch in production with origin %s',
    async (configuredUrl) => {
      if (configuredUrl === undefined) delete process.env.APP_URL
      else process.env.APP_URL = configuredUrl
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected fetch'))

      const page = await render()

      expect(fetchMock).not.toHaveBeenCalled()
      expect(page.props.initialPayload).toBeNull()
    },
  )

  it('preserves an API denial', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'Forbidden' }, { status: 403 }))

    const page = await render()

    expect(page.props).toMatchObject({ initialPayload: null, initialLoadError: 'Forbidden' })
  })
})

it('uses the configured public application URL when the server URL is unset', async () => {
  delete process.env.APP_URL
  process.env.NEXT_PUBLIC_APP_URL = 'https://example.com'
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(payload))

  await pages[1].render()

  expect(fetchMock).toHaveBeenCalledWith('https://example.com/api/checkout/pay/example', expect.anything())
})

it('defaults to the local development origin without configuration', async () => {
  process.env = { ...process.env, NODE_ENV: 'development' }
  delete process.env.APP_URL
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(payload))

  await pages[1].render()

  expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api/checkout/pay/example', expect.anything())
})
