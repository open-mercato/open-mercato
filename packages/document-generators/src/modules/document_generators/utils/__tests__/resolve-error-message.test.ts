import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveErrorMessage } from '..'

// Stand-in translator: returns the English fallback so assertions read literally.
const t = ((_key: string, fallback?: string) => fallback ?? _key) as unknown as TranslateFn

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

describe('resolveErrorMessage', () => {
  it('returns the generic message when there is no response', async () => {
    await expect(resolveErrorMessage(undefined, t)).resolves.toBe('Failed to generate document.')
  })

  it('maps the organization_required code to a specific hint', async () => {
    const res = jsonResponse({ error: 'organization_required' })
    await expect(resolveErrorMessage(res, t)).resolves.toBe('Select an organization to generate this document.')
  })

  it('surfaces a server-provided message when present', async () => {
    const res = jsonResponse({ message: 'Record is archived and cannot be exported.' })
    await expect(resolveErrorMessage(res, t)).resolves.toBe('Record is archived and cannot be exported.')
  })

  it('falls back to generic for a non-JSON body (e.g. a PDF stream)', async () => {
    const res = new Response('%PDF-1.7 binary…', { headers: { 'content-type': 'application/pdf' } })
    await expect(resolveErrorMessage(res, t)).resolves.toBe('Failed to generate document.')
  })

  it('falls back to generic when the JSON body carries no known field', async () => {
    const res = jsonResponse({ unrelated: true })
    await expect(resolveErrorMessage(res, t)).resolves.toBe('Failed to generate document.')
  })

  it('does not consume the original response body (uses a clone)', async () => {
    const res = jsonResponse({ error: 'organization_required' })
    await resolveErrorMessage(res, t)
    // The original body must remain readable for any downstream consumer.
    await expect(res.json()).resolves.toEqual({ error: 'organization_required' })
  })
})
