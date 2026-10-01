import { NextResponse } from 'next/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { AttachmentAccessDecision } from './access-types'

export async function attachmentAccessErrorBody(status: number): Promise<{ error: string }> {
  const { t } = await resolveTranslations()
  const key = status === 401 ? 'unauthorized' : status === 404 ? 'notFound' : status === 504 ? 'timeout' : 'forbidden'
  return { error: t(`attachments.access.${key}`) }
}

export async function attachmentAccessErrorResponse(decision: Extract<AttachmentAccessDecision, { ok: false }>): Promise<NextResponse> {
  return NextResponse.json(await attachmentAccessErrorBody(decision.status), {
    status: decision.status, headers: { 'Cache-Control': 'private, no-store' },
  })
}

export async function throwAttachmentAccessError(status: number): Promise<never> {
  throw new CrudHttpError(status, await attachmentAccessErrorBody(status))
}

export function withAttachmentAccessErrors<Arguments extends unknown[]>(handler: (...args: Arguments) => Promise<Response>) {
  return async (...args: Arguments): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (error) {
      if (isCrudHttpError(error)) {
        return NextResponse.json(error.body, { status: error.status, headers: { 'Cache-Control': 'private, no-store' } })
      }
      throw error
    }
  }
}
