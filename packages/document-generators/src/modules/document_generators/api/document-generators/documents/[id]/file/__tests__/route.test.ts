import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveDocumentRequestContext } from '../../../../../_shared/request-context'
import { GenerationHistoryService } from '../../../../../../services/generation-history-service'
import { templateRegistry, UnknownTemplateError } from '../../../../../../lib/template-registry'
import { GET, metadata, openApi } from '../route'

jest.mock('../../../../../_shared/request-context', () => ({ resolveDocumentRequestContext: jest.fn() }))
jest.mock('../../../../../../services/generation-history-service', () => ({ GenerationHistoryService: jest.fn() }))
jest.mock('@open-mercato/shared/lib/logger', () => ({ createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }) }))

const HISTORY_ID = '5b59688c-7101-4fe7-b4b7-23c8ab83bb01'
const translate = (key: string, fallback?: string) => fallback ?? key
const baseAuth = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-home' }

const findOne = jest.fn()
const readScoped = jest.fn()
const userHasAllFeatures = jest.fn()
const resolveForRequest = jest.fn()
let attachmentService: Record<string, unknown> | undefined

function setContext(auth: Record<string, unknown> | null) {
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return {}
      if (name === 'organizationScopeService') return { resolveForRequest }
      if (name === 'rbacService') return { userHasAllFeatures }
      if (name === 'attachmentService' && attachmentService) return attachmentService
      throw new Error(`unknown ${name}`)
    },
  }
  ;(resolveDocumentRequestContext as jest.Mock).mockResolvedValue({ container, auth, translate, locale: 'en' })
}

const storedRecord = {
  id: HISTORY_ID,
  resourceId: 'order-1',
  resourceKind: 'sales.order',
  templateId: 'sales.order-invoice',
  attachmentId: 'attachment-1',
}

const call = (id = HISTORY_ID) => GET(new Request(`http://localhost/api/document-generators/documents/${id}/file`), { params: { id } })

const getTemplateMetadataSpy = jest.spyOn(templateRegistry, 'getTemplateMetadata')

beforeEach(() => {
  findOne.mockReset().mockResolvedValue(storedRecord)
  ;(GenerationHistoryService as unknown as jest.Mock).mockReset().mockImplementation(() => ({ findOne }))
  readScoped.mockReset().mockResolvedValue({
    buffer: Buffer.from('%PDF-1.4'),
    contentType: 'application/pdf',
    contentDisposition: 'attachment; filename="invoice-ORD-1.pdf"',
    fileName: 'invoice-ORD-1.pdf',
    mimeType: 'application/pdf',
  })
  attachmentService = { createScoped: jest.fn(), readScoped }
  userHasAllFeatures.mockReset().mockResolvedValue(true)
  resolveForRequest.mockReset().mockResolvedValue({ selectedId: 'org-selected', allowedIds: null, filterIds: null, tenantId: 'tenant-1' })
  getTemplateMetadataSpy.mockReset().mockReturnValue({
    id: 'sales.order-invoice',
    label: 'Invoice',
    description: '',
    module: 'sales',
    resourceKind: 'sales.order',
    documentType: 'invoice',
    format: 'pdf',
    tags: [],
    requiredFeatures: ['sales.orders.view'],
  })
  setContext(baseAuth)
})

afterAll(() => getTemplateMetadataSpy.mockRestore())

describe('stored document download route', () => {
  it('declares its public path and the view guard', () => {
    expect(metadata).toEqual({
      path: '/document-generators/documents/[id]/file',
      GET: { requireAuth: true, requireFeatures: ['document_generators.documents.view'] },
    })
    expect(openApi.methods.GET?.operationId).toBeTruthy()
  })

  it('answers 401 without auth and 400 for a malformed id', async () => {
    setContext(null)
    expect((await call()).status).toBe(401)
    setContext(baseAuth)
    const response = await call('not-a-uuid')
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_request')
    expect(findOne).not.toHaveBeenCalled()
  })

  it('streams the stored file read with the exact owner, assignment, private partition and selected scope', async () => {
    const response = await call()
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toContain('invoice-ORD-1.pdf')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('%PDF-1.4')
    expect(findOne).toHaveBeenCalledWith({ tenantId: 'tenant-1', organizationId: 'org-selected' }, HISTORY_ID)
    expect(userHasAllFeatures).toHaveBeenCalledWith('user-1', ['sales.orders.view'], { tenantId: 'tenant-1', organizationId: 'org-selected' })
    expect(readScoped).toHaveBeenCalledWith({
      attachmentId: 'attachment-1',
      auth: expect.objectContaining({ orgId: 'org-selected' }),
      expectedOwner: { entityId: 'document_generators:document', recordId: 'order-1' },
      expectedAssignment: { type: 'document_generators:document', id: 'order-1' },
      expectedPartitionCode: 'privateAttachments',
      requirePrivatePartition: true,
      forceDownload: true,
    })
  })

  it('answers 404 when the entry is missing, foreign or has no stored file', async () => {
    findOne.mockResolvedValueOnce(null)
    expect((await call()).status).toBe(404)
    findOne.mockResolvedValueOnce({ ...storedRecord, attachmentId: null })
    const response = await call()
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe('not_found')
    expect(readScoped).not.toHaveBeenCalled()
  })

  it('answers 403 without the template features and never reads the file', async () => {
    userHasAllFeatures.mockResolvedValue(false)
    const response = await call()
    expect(response.status).toBe(403)
    expect((await response.json()).requiredFeatures).toEqual(['sales.orders.view'])
    expect(readScoped).not.toHaveBeenCalled()
  })

  it('answers 404 when the template is no longer registered or the attachment service rejects the read', async () => {
    getTemplateMetadataSpy.mockImplementationOnce(() => { throw new UnknownTemplateError('sales.order-invoice') })
    expect((await call()).status).toBe(404)
    readScoped.mockRejectedValueOnce(new CrudHttpError(404, { error: 'Attachment not found' }))
    expect((await call()).status).toBe(404)
  })

  it('answers 404 when the attachments service is not available', async () => {
    attachmentService = undefined
    expect((await call()).status).toBe(404)
  })
})
