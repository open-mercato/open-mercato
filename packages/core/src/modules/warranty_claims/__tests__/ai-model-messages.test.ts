import { generateObject } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'
import { toWarrantyModelMessages } from '../lib/aiAssist'

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

type RecordedPart = { type: string; mediaType?: string; filename?: string; data?: unknown; text?: string }

function recordingModel(calls: Array<Array<{ role: string; content: unknown }>>): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    supportedUrls: { '*/*': [/^https:\/\//] },
    doGenerate: async (options) => {
      calls.push(options.prompt as Array<{ role: string; content: unknown }>)
      return {
        content: [{ type: 'text', text: JSON.stringify({ verdict: 'covered' }) }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }
    },
  })
}

/**
 * The warranty vision helpers hand resolved attachment parts to `generateObject`.
 * Those parts arrive in the chat UI file shape, so they must be converted to model
 * messages; otherwise the AI SDK rejects the prompt and no photo reaches the model.
 */
describe('toWarrantyModelMessages', () => {
  it('produces messages the AI SDK accepts, carrying the image to the model', async () => {
    const messages = await toWarrantyModelMessages('Assess the damage.', [
      { type: 'file', mediaType: 'image/png', filename: 'damage.png', url: `data:image/png;base64,${PNG_BASE64}` },
    ])
    const calls: Array<Array<{ role: string; content: unknown }>> = []

    const result = await generateObject({
      model: recordingModel(calls),
      schema: z.object({ verdict: z.string() }),
      messages,
    })

    expect(result.object).toEqual({ verdict: 'covered' })
    expect(calls).toHaveLength(1)
    const userMessage = calls[0].find((message) => message.role === 'user')
    const parts = (userMessage?.content ?? []) as RecordedPart[]
    expect(parts.find((part) => part.type === 'text')?.text).toBe('Assess the damage.')
    const filePart = parts.find((part) => part.type === 'file')
    expect(filePart).toMatchObject({ type: 'file', mediaType: 'image/png', filename: 'damage.png' })
    expect(filePart?.data).toEqual({ type: 'data', data: PNG_BASE64 })
  })

  it('carries a proof-of-purchase PDF and a signed https URL to the model', async () => {
    const pdfBase64 = Buffer.from('%PDF-1.4 receipt').toString('base64')
    const signedUrl = 'https://files.example.test/receipt.pdf?signature=abc'
    const messages = await toWarrantyModelMessages('Extract the purchase date.', [
      { type: 'file', mediaType: 'application/pdf', filename: 'receipt.pdf', url: `data:application/pdf;base64,${pdfBase64}` },
      { type: 'file', mediaType: 'application/pdf', filename: 'signed.pdf', url: signedUrl },
    ])
    const calls: Array<Array<{ role: string; content: unknown }>> = []

    await generateObject({
      model: recordingModel(calls),
      schema: z.object({ verdict: z.string() }),
      messages,
    })

    const userMessage = calls[0]?.find((message) => message.role === 'user')
    const fileParts = ((userMessage?.content ?? []) as RecordedPart[]).filter((part) => part.type === 'file')
    expect(fileParts).toHaveLength(2)
    expect(fileParts[0]).toMatchObject({ mediaType: 'application/pdf', filename: 'receipt.pdf', data: { type: 'data', data: pdfBase64 } })
    expect(fileParts[1]).toMatchObject({ mediaType: 'application/pdf', filename: 'signed.pdf' })
    expect(JSON.stringify(fileParts[1].data)).toContain(signedUrl)
  })
})
