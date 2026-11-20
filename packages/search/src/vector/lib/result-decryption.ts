import {
  parseDecryptedFieldValue,
  type TenantDataEncryptionService,
} from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { VectorLinkDescriptor } from '../types'
import { reportSearchError, searchDebugWarn } from '../../lib/debug'

export type VectorResultFields = {
  resultTitle: string
  resultSubtitle: string | null
  resultIcon: string | null
  resultSnapshot: string | null
  primaryLinkHref: string | null
  primaryLinkLabel: string | null
  links: VectorLinkDescriptor[] | string | null
  payload: Record<string, unknown> | string | null
}

export async function decryptVectorResultFields(
  args: VectorResultFields & { tenantId: string; organizationId: string | null },
  service: TenantDataEncryptionService | null | undefined,
): Promise<VectorResultFields> {
  const { tenantId, organizationId, ...fields } = args
  if (!service?.isEnabled?.() || typeof service.decryptEntityPayload !== 'function') return fields
  try {
    const decrypted = await service.decryptEntityPayload('vector:vector_search', fields, tenantId, organizationId)
    const links = decrypted.links ?? fields.links
    const payload = decrypted.payload ?? fields.payload
    return {
      resultTitle: String(decrypted.resultTitle ?? fields.resultTitle),
      resultSubtitle: (decrypted.resultSubtitle ?? fields.resultSubtitle) as string | null,
      resultIcon: (decrypted.resultIcon ?? fields.resultIcon) as string | null,
      resultSnapshot: (decrypted.resultSnapshot ?? fields.resultSnapshot) as string | null,
      primaryLinkHref: (decrypted.primaryLinkHref ?? fields.primaryLinkHref) as string | null,
      primaryLinkLabel: (decrypted.primaryLinkLabel ?? fields.primaryLinkLabel) as string | null,
      links: (typeof links === 'string' ? parseDecryptedFieldValue(links) : links) as VectorResultFields['links'],
      payload: (typeof payload === 'string' ? parseDecryptedFieldValue(payload) : payload) as VectorResultFields['payload'],
    }
  } catch (error) {
    searchDebugWarn('vector.index', 'Vector entry decryption failed; refusing to return ciphertext as plaintext', {
      entityId: 'vector:vector_search', tenantId, organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    reportSearchError('vector.index', error, 'search.vector_result_decryption_failed', {
      tenantId, organizationId: organizationId ?? undefined,
    })
    throw error instanceof Error ? error : new Error('[internal] Vector entry decryption failed')
  }
}
