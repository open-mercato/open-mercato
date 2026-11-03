import type { EntityManager } from '@mikro-orm/postgresql'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { documentContentPutSchema } from '../data/validators'
import { materializeDocumentContentReplacement } from '../lib/collabMaterializer'
import { mutateDocumentContentState } from '../lib/contentService'
import {
  decodeBoundedCanonicalBase64,
  DOCUMENTS_MAX_CONTENT_HTML_BYTES,
  DOCUMENTS_MAX_YJS_STATE_BYTES,
  maxBase64EncodedLength,
} from '../lib/resourceLimits'
import { materializeDocumentVersion } from '../lib/versionContent'

describe('document body resource limits', () => {
  it('validates content by UTF-8 bytes rather than JavaScript character count', () => {
    const oversizedUnicode = '\u{1f600}'.repeat(Math.floor(DOCUMENTS_MAX_CONTENT_HTML_BYTES / 4) + 1)

    const parsed = documentContentPutSchema.safeParse({ contentHtml: oversizedUnicode })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe('documents.validation.content.tooLarge')
    }
  })

  it('rejects oversized state at the persistence boundary before touching the entity manager', async () => {
    let thrown: unknown
    try {
      await mutateDocumentContentState(
        {} as EntityManager,
        '11111111-1111-4111-8111-111111111111',
        {
          tenantId: '22222222-2222-4222-8222-222222222222',
          organizationId: '33333333-3333-4333-8333-333333333333',
        },
        { yjsState: Buffer.alloc(DOCUMENTS_MAX_YJS_STATE_BYTES + 1) },
      )
    } catch (error) {
      thrown = error
    }
    expect(isCrudHttpError(thrown)).toBe(true)
    if (isCrudHttpError(thrown)) expect(thrown.status).toBe(413)
  })

  it('rejects oversized current CRDT state before materializing a REST replacement', () => {
    expect(() => materializeDocumentContentReplacement(
      Buffer.alloc(DOCUMENTS_MAX_YJS_STATE_BYTES + 1),
      '<p>Replacement</p>',
    )).toThrow()
  })

  it('rejects oversized historical snapshots before applying the Yjs update', () => {
    expect(() => materializeDocumentVersion({
      yjsSnapshot: Buffer.alloc(DOCUMENTS_MAX_YJS_STATE_BYTES + 1),
      contentHtml: '',
    })).toThrow()
  })

  it('checks canonical base64 length before allocating decoded undo state', () => {
    const oversized = 'A'.repeat(maxBase64EncodedLength(DOCUMENTS_MAX_YJS_STATE_BYTES) + 4)
    const decodeSpy = jest.spyOn(Buffer, 'from')

    expect(() => decodeBoundedCanonicalBase64(
      oversized,
      DOCUMENTS_MAX_YJS_STATE_BYTES,
    )).toThrow()
    expect(decodeSpy).not.toHaveBeenCalled()
    decodeSpy.mockRestore()
  })
})
