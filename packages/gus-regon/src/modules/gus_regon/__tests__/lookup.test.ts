import type { GusRequest } from '../lib/client'
import { GUS_PRODUCTION_URL, GUS_PUBLIC_TEST_KEY, GUS_TEST_URL } from '../lib/config'
import { lookupCompanyByNip } from '../lib/lookup'
import {
  LOGIN_EMPTY,
  LOGIN_OK,
  LOGOUT_OK,
  SEARCH_FOUND_INNER,
  SEARCH_MULTIPLE_INNER,
  SEARCH_NOT_FOUND_INNER,
  SEARCH_SESSION_ERROR_INNER,
  searchResponse,
} from './fixtures/bir'

type Step = { action: string; status?: number; body: string } | { action: string; error: Error }

function scripted(steps: Step[]) {
  const actions: string[] = []
  const urls: string[] = []
  const bodies: string[] = []
  const request: GusRequest = async (url, init) => {
    const body = String(init.body)
    const action = /IUslugaBIRzewnPubl\/(\w+)<\/wsa:Action>/.exec(body)?.[1] ?? 'unknown'
    actions.push(action)
    urls.push(url)
    bodies.push(body)
    const step = steps.shift()
    if (!step || step.action !== action) throw new Error(`unexpected ${action}`)
    if ('error' in step) throw step.error
    return new Response(step.body, { status: step.status ?? 200 })
  }
  return { request, actions, urls, bodies }
}

const silent = { warn: () => undefined }

describe('lookupCompanyByNip', () => {
  it('returns not_configured for production without an API key and makes no request', async () => {
    const { request, actions } = scripted([])
    await expect(lookupCompanyByNip({ environment: 'production' }, '5252344078', { request, logger: silent })).resolves.toEqual({
      ok: false,
      reason: 'not_configured',
    })
    expect(actions).toEqual([])
  })

  it('finds a company on the test endpoint with the public test key and logs out', async () => {
    const { request, actions, urls, bodies } = scripted([
      { action: 'Zaloguj', body: LOGIN_OK },
      { action: 'DaneSzukajPodmioty', body: searchResponse(SEARCH_FOUND_INNER) },
      { action: 'Wyloguj', body: LOGOUT_OK },
    ])
    const result = await lookupCompanyByNip({ environment: 'test' }, '525-234-40-78', { request, logger: silent })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.company.regon).toBe('140182840')
    expect(result.company.city).toBe('Warszawa')
    expect(result.candidates).toHaveLength(1)
    expect(actions).toEqual(['Zaloguj', 'DaneSzukajPodmioty', 'Wyloguj'])
    expect(new Set(urls)).toEqual(new Set([GUS_TEST_URL]))
    expect(bodies[0]).toContain(GUS_PUBLIC_TEST_KEY)
    expect(bodies[1]).toContain('<dat:Nip>5252344078</dat:Nip>')
  })

  it('uses the production endpoint with the configured key', async () => {
    const { request, urls, bodies } = scripted([
      { action: 'Zaloguj', body: LOGIN_OK },
      { action: 'DaneSzukajPodmioty', body: searchResponse(SEARCH_FOUND_INNER) },
      { action: 'Wyloguj', body: LOGOUT_OK },
    ])
    await lookupCompanyByNip({ environment: 'production', apiKey: 'prod-key-123' }, '5252344078', { request, logger: silent })
    expect(new Set(urls)).toEqual(new Set([GUS_PRODUCTION_URL]))
    expect(bodies[0]).toContain('prod-key-123')
    expect(bodies[0]).not.toContain(GUS_PUBLIC_TEST_KEY)
  })

  it('picks the registered entity when GUS returns several records', async () => {
    const { request } = scripted([
      { action: 'Zaloguj', body: LOGIN_OK },
      { action: 'DaneSzukajPodmioty', body: searchResponse(SEARCH_MULTIPLE_INNER) },
      { action: 'Wyloguj', body: LOGOUT_OK },
    ])
    const result = await lookupCompanyByNip({}, '5252344078', { request, logger: silent })
    expect(result.ok && result.company.type).toBe('P')
    expect(result.ok && result.candidates).toHaveLength(2)
  })

  it('returns not_found for ErrorCode 4 and still logs out', async () => {
    const { request, actions } = scripted([
      { action: 'Zaloguj', body: LOGIN_OK },
      { action: 'DaneSzukajPodmioty', body: searchResponse(SEARCH_NOT_FOUND_INNER) },
      { action: 'Wyloguj', body: LOGOUT_OK },
    ])
    await expect(lookupCompanyByNip({}, '5252344078', { request, logger: silent })).resolves.toEqual({ ok: false, reason: 'not_found' })
    expect(actions).toContain('Wyloguj')
  })

  it('fails open as unavailable when login fails (invalid key / network)', async () => {
    const invalidKey = scripted([{ action: 'Zaloguj', body: LOGIN_EMPTY }])
    await expect(lookupCompanyByNip({}, '5252344078', { request: invalidKey.request, logger: silent })).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    })
    expect(invalidKey.actions).toEqual(['Zaloguj'])

    const network = scripted([{ action: 'Zaloguj', error: new Error('ETIMEDOUT') }])
    await expect(lookupCompanyByNip({}, '5252344078', { request: network.request, logger: silent })).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    })
  })

  it('fails open as unavailable on GUS error codes other than "not found"', async () => {
    const { request } = scripted([
      { action: 'Zaloguj', body: LOGIN_OK },
      { action: 'DaneSzukajPodmioty', body: searchResponse(SEARCH_SESSION_ERROR_INNER) },
      { action: 'Wyloguj', body: LOGOUT_OK },
    ])
    await expect(lookupCompanyByNip({}, '5252344078', { request, logger: silent })).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })

  it('fails open when the search request errors, and a failing logout never breaks the result', async () => {
    const searchFails = scripted([
      { action: 'Zaloguj', body: LOGIN_OK },
      { action: 'DaneSzukajPodmioty', status: 500, body: 'boom' },
      { action: 'Wyloguj', body: LOGOUT_OK },
    ])
    await expect(lookupCompanyByNip({}, '5252344078', { request: searchFails.request, logger: silent })).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    })
    expect(searchFails.actions).toContain('Wyloguj')

    const logoutFails = scripted([
      { action: 'Zaloguj', body: LOGIN_OK },
      { action: 'DaneSzukajPodmioty', body: searchResponse(SEARCH_FOUND_INNER) },
      { action: 'Wyloguj', error: new Error('logout down') },
    ])
    const result = await lookupCompanyByNip({}, '5252344078', { request: logoutFails.request, logger: silent })
    expect(result.ok).toBe(true)
  })

  it('never logs the API key on any failure path', async () => {
    const secret = 'super-secret-key'
    const scenarios: Step[][] = [
      [{ action: 'Zaloguj', status: 500, body: `error echo ${secret}` }],
      [{ action: 'Zaloguj', error: new Error('ECONNRESET') }],
      [{ action: 'Zaloguj', body: LOGIN_EMPTY }],
      [
        { action: 'Zaloguj', body: LOGIN_OK },
        { action: 'DaneSzukajPodmioty', status: 502, body: 'bad gateway' },
        { action: 'Wyloguj', body: LOGOUT_OK },
      ],
      [
        { action: 'Zaloguj', body: LOGIN_OK },
        { action: 'DaneSzukajPodmioty', body: '<html>not soap</html>' },
        { action: 'Wyloguj', body: LOGOUT_OK },
      ],
      [
        { action: 'Zaloguj', body: LOGIN_OK },
        { action: 'DaneSzukajPodmioty', body: searchResponse(SEARCH_SESSION_ERROR_INNER) },
        { action: 'Wyloguj', body: LOGOUT_OK },
      ],
    ]
    for (const steps of scenarios) {
      const warnings: string[] = []
      const { request } = scripted(steps)
      const result = await lookupCompanyByNip({ environment: 'production', apiKey: secret }, '5252344078', {
        request,
        logger: { warn: (message: string) => warnings.push(message) },
      })
      expect(result).toEqual({ ok: false, reason: 'unavailable' })
      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings.join('\n')).not.toContain(secret)
    }
  })
})
