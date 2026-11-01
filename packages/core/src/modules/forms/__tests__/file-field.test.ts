import { V1_FIELD_TYPES } from '../schema/field-type-registry'
import { FILE_TYPE, readFileRefs } from '../schema/file-field'
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  evaluateUploadGate,
  isContentTypeAllowed,
  resolveMaxUploadBytes,
} from '../services/upload-validation'
import {
  AttachmentService,
  AttachmentServiceError,
} from '../services/attachment-service'
import { NoopUploadScanner, type UploadScanner } from '../services/upload-scanner'
import type { EncryptionService } from '../services/encryption-service'

describe('file field type (W4)', () => {
  it('is registered on the default registry with the file widget + paperclip icon', () => {
    const spec = V1_FIELD_TYPES.file
    expect(spec).toBe(FILE_TYPE)
    expect(spec.category).toBe('input')
    expect(spec.icon).toBe('paperclip')
    expect(spec.displayNameKey).toBe('forms.studio.palette.input.file')
    expect(spec.defaultUiSchema).toEqual({ widget: 'file' })
    expect(spec.renderer).toBeNull()
  })

  describe('validator', () => {
    const ref = { id: 'att-1', filename: 'box.jpg', contentType: 'image/jpeg', sizeBytes: 1024 }

    it('treats null / undefined as valid (required-ness enforced elsewhere)', () => {
      expect(FILE_TYPE.validator(null, {})).toBe(true)
      expect(FILE_TYPE.validator(undefined, {})).toBe(true)
    })

    it('accepts a single attachment id string', () => {
      expect(FILE_TYPE.validator('att-1', {})).toBe(true)
    })

    it('accepts a single ref object and an array of refs', () => {
      expect(FILE_TYPE.validator(ref, {})).toBe(true)
      expect(FILE_TYPE.validator([ref], {})).toBe(true)
    })

    it('rejects malformed refs (missing id / wrong field types)', () => {
      expect(FILE_TYPE.validator({ filename: 'x', contentType: 'image/png', sizeBytes: 1 }, {})).not.toBe(true)
      expect(FILE_TYPE.validator({ id: 1, filename: 'x', contentType: 'image/png', sizeBytes: 1 }, {})).not.toBe(true)
      expect(FILE_TYPE.validator({ id: 'a', filename: 'x', contentType: 'image/png', sizeBytes: -1 }, {})).not.toBe(true)
      expect(FILE_TYPE.validator(42, {})).not.toBe(true)
      expect(FILE_TYPE.validator('', {})).not.toBe(true)
    })

    it('rejects more than one file when x-om-multiple is not set', () => {
      expect(FILE_TYPE.validator([ref, { ...ref, id: 'att-2' }], {})).not.toBe(true)
    })

    it('accepts multiple files when x-om-multiple is true', () => {
      expect(
        FILE_TYPE.validator([ref, { ...ref, id: 'att-2' }], { 'x-om-multiple': true }),
      ).toBe(true)
    })
  })

  describe('exportAdapter', () => {
    it('joins filenames, falling back to id when filename is empty', () => {
      expect(
        FILE_TYPE.exportAdapter([
          { id: 'a', filename: 'box.jpg', contentType: 'image/jpeg', sizeBytes: 1 },
          { id: 'b', filename: '', contentType: 'image/png', sizeBytes: 1 },
        ]),
      ).toBe('box.jpg, b')
    })

    it('exports an empty string for no files', () => {
      expect(FILE_TYPE.exportAdapter(null)).toBe('')
      expect(FILE_TYPE.exportAdapter([])).toBe('')
    })
  })

  describe('readFileRefs', () => {
    it('normalizes a bare id string into a ref', () => {
      expect(readFileRefs('att-1')).toEqual([{ id: 'att-1', filename: '', contentType: '', sizeBytes: 0 }])
    })

    it('returns null for unparseable values', () => {
      expect(readFileRefs(42)).toBeNull()
      expect(readFileRefs({ filename: 'x' })).toBeNull()
    })
  })
})

describe('upload-validation gate (SEC-4)', () => {
  const hardCeilingBytes = 1000

  it('resolves the env hard ceiling and falls back to the default', () => {
    expect(resolveMaxUploadBytes({ FORMS_MAX_UPLOAD_BYTES: '2048' } as NodeJS.ProcessEnv)).toBe(2048)
    expect(resolveMaxUploadBytes({} as NodeJS.ProcessEnv)).toBe(DEFAULT_MAX_UPLOAD_BYTES)
    expect(resolveMaxUploadBytes({ FORMS_MAX_UPLOAD_BYTES: 'nope' } as NodeJS.ProcessEnv)).toBe(
      DEFAULT_MAX_UPLOAD_BYTES,
    )
    expect(resolveMaxUploadBytes({ FORMS_MAX_UPLOAD_BYTES: '-5' } as NodeJS.ProcessEnv)).toBe(
      DEFAULT_MAX_UPLOAD_BYTES,
    )
  })

  it('matches exact and wildcard MIME allowlist entries', () => {
    expect(isContentTypeAllowed('image/png', ['image/*'])).toBe(true)
    expect(isContentTypeAllowed('image/png', ['image/png'])).toBe(true)
    expect(isContentTypeAllowed('application/pdf', ['image/*'])).toBe(false)
    expect(isContentTypeAllowed('anything/x', [])).toBe(true)
    expect(isContentTypeAllowed('anything/x', null)).toBe(true)
  })

  it('rejects empty uploads with 413', () => {
    const result = evaluateUploadGate({ contentType: 'image/png', sizeBytes: 0, hardCeilingBytes })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('EMPTY')
      expect(result.status).toBe(413)
    }
  })

  it('rejects oversize uploads against the smaller of field cap and hard ceiling (413)', () => {
    const result = evaluateUploadGate({
      contentType: 'image/png',
      sizeBytes: 600,
      fieldMaxSizeBytes: 500,
      hardCeilingBytes,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('TOO_LARGE')
  })

  it('lets the hard ceiling win even when the field cap is larger', () => {
    const result = evaluateUploadGate({
      contentType: 'image/png',
      sizeBytes: 1200,
      fieldMaxSizeBytes: 5000,
      hardCeilingBytes,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('TOO_LARGE')
  })

  it('rejects disallowed MIME types with 422', () => {
    const result = evaluateUploadGate({
      contentType: 'application/x-msdownload',
      sizeBytes: 100,
      accept: ['image/*'],
      hardCeilingBytes,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('DISALLOWED_TYPE')
      expect(result.status).toBe(422)
    }
  })

  it('accepts a valid upload', () => {
    expect(
      evaluateUploadGate({
        contentType: 'image/png',
        sizeBytes: 100,
        accept: ['image/*'],
        fieldMaxSizeBytes: 500,
        hardCeilingBytes,
      }),
    ).toEqual({ ok: true })
  })
})

describe('AttachmentService scan hook (SEC-4)', () => {
  const organizationId = 'org-1'
  const tenantId = 'tenant-1'
  const submissionId = 'sub-1'

  function buildEm(persisted: Record<string, unknown>[]) {
    const submissionRow = { id: submissionId, organizationId, tenantId, deletedAt: null }
    return {
      findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        // The service first re-fetches the scoped submission row.
        if (where.id === submissionId) return submissionRow
        return null
      }),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
        const row = { id: `att-${persisted.length + 1}`, ...data }
        return row
      }),
      persist: jest.fn((row: Record<string, unknown>) => {
        persisted.push(row)
      }),
      flush: jest.fn(async () => undefined),
    }
  }

  const encryption: EncryptionService = {
    encrypt: jest.fn(async (_org: string, plaintext: Buffer) => Buffer.concat([Buffer.from('enc:'), plaintext])),
    decrypt: jest.fn(async (_org: string, ciphertext: Buffer) => ciphertext.subarray(4)),
    currentKeyVersion: jest.fn(async () => 1),
    rotate: jest.fn(async () => 1),
  }

  const baseArgs = {
    organizationId,
    tenantId,
    submissionId,
    fieldKey: 'field_1',
    filename: 'box.jpg',
    contentType: 'image/jpeg',
    bytes: Buffer.from('hello-world'),
    uploadedBy: 'user-1',
    accept: ['image/*'],
  }

  it('persists an encrypted attachment when the scanner reports clean', async () => {
    const persisted: Record<string, unknown>[] = []
    const em = buildEm(persisted)
    const service = new AttachmentService({
      emFactory: () => em as never,
      encryptionService: encryption,
      scanner: new NoopUploadScanner(),
      hardCeilingBytes: 10 * 1024,
    })
    const result = await service.storeUpload(baseArgs)
    expect(result.filename).toBe('box.jpg')
    expect(result.sizeBytes).toBe(baseArgs.bytes.length)
    expect(persisted).toHaveLength(1)
    expect(encryption.encrypt).toHaveBeenCalledWith(organizationId, baseArgs.bytes)
    const stored = persisted[0]
    expect(Buffer.isBuffer(stored.payloadInline)).toBe(true)
    expect((stored.payloadInline as Buffer).subarray(0, 4).toString()).toBe('enc:')
    expect(stored.kind).toBe('user_upload')
  })

  it('rejects the upload with 422 when the scanner reports not-clean', async () => {
    const persisted: Record<string, unknown>[] = []
    const em = buildEm(persisted)
    const dirtyScanner: UploadScanner = {
      scan: jest.fn(async () => ({ clean: false, reason: 'EICAR test signature' })),
    }
    const service = new AttachmentService({
      emFactory: () => em as never,
      encryptionService: encryption,
      scanner: dirtyScanner,
      hardCeilingBytes: 10 * 1024,
    })
    await expect(service.storeUpload(baseArgs)).rejects.toMatchObject({
      code: 'SCAN_REJECTED',
      httpStatus: 422,
    })
    expect(persisted).toHaveLength(0)
  })

  it('rejects disallowed MIME before scanning or persisting', async () => {
    const persisted: Record<string, unknown>[] = []
    const em = buildEm(persisted)
    const scanner: UploadScanner = { scan: jest.fn(async () => ({ clean: true })) }
    const service = new AttachmentService({
      emFactory: () => em as never,
      encryptionService: encryption,
      scanner,
      hardCeilingBytes: 10 * 1024,
    })
    await expect(
      service.storeUpload({ ...baseArgs, contentType: 'application/x-msdownload' }),
    ).rejects.toBeInstanceOf(AttachmentServiceError)
    expect(scanner.scan).not.toHaveBeenCalled()
    expect(persisted).toHaveLength(0)
  })
})
