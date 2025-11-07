jest.mock('../../utils/api', () => ({
  apiFetch: jest.fn(),
}))

import { apiFetch } from '../../utils/api'
import { apiCall } from '../../utils/apiCall'

describe('apiCall', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns parsed JSON result by default', async () => {
    const payload = { ok: true }
    ;(apiFetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))
    const result = await apiCall<{ ok: boolean }>('/api/test')
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.result).toEqual(payload)
    expect(result.response).toBeInstanceOf(Response)
  })

  it('uses fallback when parsing fails', async () => {
    ;(apiFetch as jest.Mock).mockResolvedValue(new Response('not json', { status: 200 }))
    const result = await apiCall<{ ok: boolean }>('/api/test', undefined, { fallback: { ok: false } })
    expect(result.result).toEqual({ ok: false })
  })

  it('supports custom parser', async () => {
    const response = new Response('data', { status: 202 })
    ;(apiFetch as jest.Mock).mockResolvedValue(response)
    const parser = jest.fn(async () => ({ parsed: true }))
    const result = await apiCall<{ parsed: boolean }>('/api/custom', undefined, { parse: parser })
    expect(parser).toHaveBeenCalled()
    expect(result.result).toEqual({ parsed: true })
  })
})
