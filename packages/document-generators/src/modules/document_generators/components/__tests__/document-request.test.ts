import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { requestDocument, requestStoredDocument } from '../document-request'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))

const apiCallMock = apiCall as jest.Mock
const translate = (key: string, fallback?: string) => fallback ?? key

describe('requestStoredDocument', () => {
  beforeEach(() => apiCallMock.mockReset())

  it('downloads the stored file through the scoped history endpoint', async () => {
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' })
    const response = new Response(null, { headers: { 'Content-Disposition': 'attachment; filename="invoice-ORD-1.pdf"' } })
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: blob, response })

    const result = await requestStoredDocument({ historyId: 'history 1', translate })

    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/document-generators/documents/history%201/file',
      { method: 'GET' },
      expect.objectContaining({ parse: expect.any(Function) }),
    )
    expect(result).toEqual({ blob, filename: 'invoice-ORD-1.pdf' })
  })

  it('surfaces a translated error when the file is not available', async () => {
    const payload = new Blob([JSON.stringify({ error: 'not_found', message: 'Document source not found.' })])
    apiCallMock.mockResolvedValue({ ok: false, status: 404, result: payload, response: new Response(null, { status: 404 }) })

    await expect(requestStoredDocument({ historyId: 'history-1', translate })).rejects.toThrow()
  })
})

describe('requestDocument', () => {
  beforeEach(() => apiCallMock.mockReset())

  it('sends template_version only for an explicitly selected archived version', async () => {
    const blob = new Blob(['%PDF'])
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: blob, response: new Response(null) })
    await requestDocument({ action: 'preview', templateId: 'sales.offer', recordId: 'q-1', translate })
    await requestDocument({ action: 'generate', templateId: 'sales.offer', recordId: 'q-1', templateVersion: '2', translate })
    expect(JSON.parse(apiCallMock.mock.calls[0][1].body)).toEqual({ template_id: 'sales.offer', data: { id: 'q-1' } })
    expect(JSON.parse(apiCallMock.mock.calls[1][1].body)).toEqual({ template_id: 'sales.offer', template_version: '2', data: { id: 'q-1' } })
  })
})
