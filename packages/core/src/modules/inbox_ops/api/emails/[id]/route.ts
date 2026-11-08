import { NextResponse } from 'next/server'
import { LockMode } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  enforceCommandOptimisticLockWithGuards,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { InboxEmail } from '../../../data/entities'
import { inboxEmailIdParamsSchema } from '../../../data/validators'
import {
  resolveRequestContext,
  extractPathSegment,
  UnauthorizedError,
} from '../../routeHelpers'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { canViewEmailContent, serializeInboxEmail } from '../response'
import {
  releaseInboundEmailAttachments,
  softDeleteInboxEmailForRelease,
  type InboundAttachmentReleaseService,
} from '../../../lib/inboundAttachmentRelease'
import { reportInboundAttachmentError } from '../../../lib/inboundAttachments'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'

const logger = createLogger('inbox_ops').child({ component: 'emails' })

/** Dotted form of the module's other command locks (`inbox_ops.settings`, `inbox_ops.action`). */
const EMAIL_LOCK_RESOURCE_KIND = 'inbox_ops.email'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['inbox_ops.log.view'] },
  DELETE: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.manage'] },
}

function tryResolve<T>(container: { resolve: (name: string) => unknown }, name: string): T | null {
  try {
    return (container.resolve(name) as T | undefined) ?? null
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const url = new URL(req.url)
    const id = extractPathSegment(url, 'emails')

    if (!id) {
      return NextResponse.json({ error: translate('inbox_ops.errors.missingEmailId', 'Missing email ID') }, { status: 400 })
    }

    const ctx = await resolveRequestContext(req)
    const notFound = () => NextResponse.json({ error: translate('inbox_ops.errors.emailNotFound', 'Email not found') }, { status: 404 })
    // A non-uuid id names no email; answer 404 instead of letting Postgres reject the cast.
    if (!inboxEmailIdParamsSchema.safeParse({ id }).success) return notFound()

    const email = await findOneWithDecryption(
      ctx.em,
      InboxEmail,
      {
        id,
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        deletedAt: null,
      },
      undefined,
      ctx.scope,
    )

    if (!email) return notFound()

    const includeContent = await canViewEmailContent(ctx)
    return NextResponse.json({ email: serializeInboxEmail(email, includeContent) })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: translate('inbox_ops.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }
    logger.error('Failed to load email detail', { err })
    return NextResponse.json({ error: translate('inbox_ops.errors.emailLoadFailed', 'Failed to load email') }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const url = new URL(req.url)
    const id = extractPathSegment(url, 'emails')

    if (!id) {
      return NextResponse.json({ error: translate('inbox_ops.errors.missingEmailId', 'Missing email ID') }, { status: 400 })
    }

    const ctx = await resolveRequestContext(req)
    if (!inboxEmailIdParamsSchema.safeParse({ id }).success) {
      return NextResponse.json({ error: translate('inbox_ops.errors.emailNotFound', 'Email not found') }, { status: 404 })
    }

    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      resourceKind: 'inbox_ops:inbox_email',
      resourceId: id,
      operation: 'delete',
      requestMethod: req.method,
      requestHeaders: req.headers,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const emailRef = { id, tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    // The locked read serializes the version check with concurrent writers of the row (extraction,
    // reprocess, the ingest worker's claim renewal); the soft delete then runs under the same lock.
    // Both version checks are no-ops without the optimistic-lock header, so plain API consumers
    // keep today's behavior.
    const deleted = await ctx.em.transactional(async (tx) => {
      const email = await findOneWithDecryption(
        tx,
        InboxEmail,
        { id, organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null },
        // Only the version is needed, so the locked read does not decrypt the whole row.
        { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true, fields: ['id', 'updatedAt'] },
        ctx.scope,
      )
      if (!email) {
        enforceRecordGoneIsConflict({ resourceKind: EMAIL_LOCK_RESOURCE_KIND, resourceId: id, request: req })
        return false
      }
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: EMAIL_LOCK_RESOURCE_KIND,
        resourceId: email.id,
        current: email.updatedAt ?? null,
        request: req,
      })
      return softDeleteInboxEmailForRelease(tx, emailRef)
    })

    if (!deleted) {
      return NextResponse.json({ error: translate('inbox_ops.errors.emailNotFound', 'Email not found') }, { status: 404 })
    }

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        resourceKind: 'inbox_ops:inbox_email',
        resourceId: id,
        operation: 'delete',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    try {
      await releaseInboundEmailAttachments({
        em: ctx.em,
        email: emailRef,
        attachmentService: tryResolve<InboundAttachmentReleaseService>(ctx.container, 'attachmentService'),
        encryptionService: tryResolve<TenantDataEncryptionService>(ctx.container, 'tenantEncryptionService'),
      })
    } catch (releaseError) {
      logger.warn('Deferred the attachment release of a deleted email to the maintenance sweep', { emailId: id, err: releaseError })
      reportInboundAttachmentError(releaseError, 'inbox_ops.attachment_release_failed', { emailId: id })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: translate('inbox_ops.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('Failed to delete email', { err })
    return NextResponse.json({ error: translate('inbox_ops.errors.emailDeleteFailed', 'Failed to delete email') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Email detail',
  methods: {
    GET: {
      summary: 'Get email detail with parsed thread',
      description: 'The email with its parsed thread. `attachmentsStatus` is the attachment ingestion state (`pending`, `processing`, `completed`, or `null` for mail without recorded attachment parts; like the other content fields it is `null` for callers without `inbox_ops.proposals.view`); list the parts with `GET /api/inbox_ops/emails/{id}/attachments`. A non-uuid id answers 404.',
      responses: [
        { status: 200, description: 'Email detail' },
        { status: 404, description: 'Email not found' },
      ],
    },
    DELETE: {
      summary: 'Soft-delete an inbox email',
      description: 'Soft-deletes the email and releases its stored attachments and their quota. With the optimistic-lock header (`x-om-ext-optimistic-lock-expected-updated-at`, the email\'s `updatedAt`), a stale version answers 409 with the standard conflict body, and so does an email deleted concurrently; without the header a missing email answers 404.',
      responses: [
        { status: 200, description: 'Email deleted' },
        { status: 404, description: 'Email not found' },
        { status: 409, description: 'Optimistic-lock conflict: the email changed or was deleted since the caller read it' },
      ],
    },
  },
}
