const createRequestContainer = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

describe('GET /api/configs/health/ready', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns ready when required runtime checks pass', async () => {
    createRequestContainer.mockResolvedValue({
      resolve: () => ({ getReadiness: () => ({ ready: true }) }),
    })
    const { GET } = await import('../health/ready/route')

    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ready' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('returns 503 when tenant encryption is not ready', async () => {
    createRequestContainer.mockResolvedValue({
      resolve: () => ({ getReadiness: () => ({ ready: false }) }),
    })
    const { GET } = await import('../health/ready/route')

    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      status: 'not_ready',
      check: 'tenant_data_encryption',
    })
  })

  it('returns 503 when bootstrap fails', async () => {
    createRequestContainer.mockRejectedValue(new Error('bootstrap failed'))
    const { GET } = await import('../health/ready/route')

    const response = await GET()

    expect(response.status).toBe(503)
  })
})
