/**
 * Forms DistributionService — phase 2d.
 *
 * Orchestrates the distribution / invitation layer that puts a published form
 * in front of an unauthenticated participant and bootstraps an anonymous
 * submission by delegating to the unchanged `SubmissionService`.
 *
 * Invariants:
 *  - Every query is tenant-scoped (`organization_id` + `tenant_id`) EXCEPT the
 *    two deliberately-global lookups — by random `public_slug` and by
 *    `token_hash` — both high-entropy and globally unique in practice. After a
 *    global lookup the org/tenant scope is taken from the found row and used
 *    for every subsequent query.
 *  - Recipient PII (`recipient_email` / `recipient_name`) is encrypted via the
 *    GLOBAL pipeline; reads that need the plaintext use `findOneWithDecryption`.
 *  - The submission access token never carries org/tenant — those are
 *    re-derived from the persisted submission downstream (see runtime-principal).
 */

import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  Form,
  FormDistribution,
  FormInvitation,
  FormVersion,
} from '../data/entities'
import type { CompiledFormVersion } from './form-version-compiler'
import type { SubmissionService, SubmissionViewModel } from './submission-service'
import type { StructuredLogger } from '../lib/log-redaction'
import { formsEventPayloadSchemas } from '../events-payloads'
import {
  getAccessTokenTtlSeconds,
  hashInvitationToken,
  signAccessToken,
} from './distribution-token'

export type DistributionServiceErrorCode =
  | 'NOT_FOUND'
  | 'GONE'
  | 'INVALID_STATUS'

export class DistributionServiceError extends Error {
  readonly code: DistributionServiceErrorCode
  readonly httpStatus: number
  readonly details?: Record<string, unknown>

  constructor(
    code: DistributionServiceErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DistributionServiceError'
    this.code = code
    this.httpStatus = httpStatus
    this.details = details
  }
}

type DistributionEvents = {
  'forms.invitation.opened': z.infer<typeof formsEventPayloadSchemas['forms.invitation.opened']>
  'forms.invitation.submitted': z.infer<typeof formsEventPayloadSchemas['forms.invitation.submitted']>
}

export type DistributionServiceOptions = {
  emFactory: () => EntityManager
  submissionService: SubmissionService
  /** Pluggable, schema-validated event emitter — wired in di.ts. */
  emitEvent: <K extends keyof DistributionEvents>(eventId: K, payload: DistributionEvents[K]) => Promise<void> | void
  now?: () => Date
  logger?: StructuredLogger
}

const noopLogger: StructuredLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

const INVITATION_TERMINAL_STATUSES: ReadonlySet<string> = new Set(['submitted', 'revoked', 'expired'])

export type BeginAnonymousArgs = {
  distribution: FormDistribution
  invitation?: FormInvitation
  locale?: string | null
}

export type BeginAnonymousResult = {
  view: SubmissionViewModel
  invitation: FormInvitation
  accessToken: string
  expiresAt: string
}

export type FormContextResult = {
  form: Form
  formVersion: FormVersion
  compiled: CompiledFormVersion
}

export class DistributionService {
  private readonly emFactory: () => EntityManager
  private readonly submissionService: SubmissionService
  private readonly emitEvent: DistributionServiceOptions['emitEvent']
  private readonly now: () => Date
  private readonly logger: StructuredLogger

  constructor(options: DistributionServiceOptions) {
    this.emFactory = options.emFactory
    this.submissionService = options.submissionService
    this.emitEvent = options.emitEvent
    this.now = options.now ?? (() => new Date())
    this.logger = options.logger ?? noopLogger
  }

  // --------------------------------------------------------------------------
  // Resolve — open link (global slug lookup)
  // --------------------------------------------------------------------------

  async resolveBySlug(slug: string): Promise<{ distribution: FormDistribution }> {
    const em = this.emFactory()
    const distribution = await em.findOne(FormDistribution, {
      publicSlug: slug,
      deletedAt: null,
    })
    if (!distribution) {
      throw new DistributionServiceError('NOT_FOUND', 'Distribution not found.', 404)
    }
    this.assertDistributionAvailable(distribution)
    return { distribution }
  }

  // --------------------------------------------------------------------------
  // Resolve — personal invitation (global token-hash lookup)
  // --------------------------------------------------------------------------

  async resolveByToken(rawToken: string): Promise<{ invitation: FormInvitation; distribution: FormDistribution }> {
    const em = this.emFactory()
    const tokenHash = hashInvitationToken(rawToken)
    // Locate the row first (no scope) to derive org/tenant, then re-read with
    // decryption scoped to that row so recipient PII is available to the caller.
    const located = await em.findOne(FormInvitation, {
      tokenHash,
      deletedAt: null,
    })
    if (!located) {
      throw new DistributionServiceError('NOT_FOUND', 'Invitation not found.', 404)
    }
    const invitation = await findOneWithDecryption(
      em,
      FormInvitation,
      { id: located.id, organizationId: located.organizationId, tenantId: located.tenantId, deletedAt: null },
      undefined,
      { organizationId: located.organizationId, tenantId: located.tenantId },
    )
    if (!invitation) {
      throw new DistributionServiceError('NOT_FOUND', 'Invitation not found.', 404)
    }

    this.assertInvitationUsable(invitation)

    const distribution = await em.findOne(FormDistribution, {
      id: invitation.distributionId,
      organizationId: invitation.organizationId,
      tenantId: invitation.tenantId,
      deletedAt: null,
    })
    if (!distribution) {
      throw new DistributionServiceError('NOT_FOUND', 'Distribution not found.', 404)
    }
    this.assertDistributionAvailable(distribution)

    // Mark opened on first resolve from a pre-fill status.
    if (invitation.status === 'pending' || invitation.status === 'sent') {
      invitation.status = 'opened'
      invitation.openedAt = this.now()
      await em.flush()
      await this.safeEmit('forms.invitation.opened', { invitationId: invitation.id })
    }

    return { invitation, distribution }
  }

  // --------------------------------------------------------------------------
  // Form context — resolve the served form version for a distribution
  // --------------------------------------------------------------------------

  async getFormContext(args: { distribution: FormDistribution }): Promise<FormContextResult> {
    const { distribution } = args
    const em = this.emFactory()
    const form = await em.findOne(Form, {
      id: distribution.formId,
      organizationId: distribution.organizationId,
      tenantId: distribution.tenantId,
      deletedAt: null,
    })
    if (!form) {
      throw new DistributionServiceError('NOT_FOUND', 'Form not found.', 404)
    }
    if (distribution.pinnedVersionId) {
      return this.submissionService.getPinnedFormVersionByKey({
        organizationId: distribution.organizationId,
        tenantId: distribution.tenantId,
        formKey: form.key,
        pinnedVersionId: distribution.pinnedVersionId,
      })
    }
    return this.submissionService.getActiveFormVersionByKey({
      organizationId: distribution.organizationId,
      tenantId: distribution.tenantId,
      formKey: form.key,
    })
  }

  // --------------------------------------------------------------------------
  // Begin anonymous — mint/link invitation, start submission, sign token
  // --------------------------------------------------------------------------

  async beginAnonymous(args: BeginAnonymousArgs): Promise<BeginAnonymousResult> {
    const { distribution } = args
    this.assertDistributionAvailable(distribution)

    const em = this.emFactory()
    const form = await em.findOne(Form, {
      id: distribution.formId,
      organizationId: distribution.organizationId,
      tenantId: distribution.tenantId,
      deletedAt: null,
    })
    if (!form) {
      throw new DistributionServiceError('NOT_FOUND', 'Form not found.', 404)
    }

    let invitation: FormInvitation
    if (args.invitation) {
      invitation = args.invitation
      this.assertInvitationUsable(invitation)
      // Resume: invitation already has a submission — return the existing one.
      if (invitation.submissionId) {
        return this.resumeExisting(distribution, form.key, invitation)
      }
    } else {
      const now = this.now()
      invitation = em.create(FormInvitation, {
        distributionId: distribution.id,
        organizationId: distribution.organizationId,
        tenantId: distribution.tenantId,
        recipientEmail: null,
        recipientName: null,
        recipientRef: null,
        role: null,
        tokenHash: null,
        status: 'started',
        submissionId: null,
        locale: args.locale ?? distribution.defaultLocale ?? null,
        sendCount: 0,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
      })
      em.persist(invitation)
      await em.flush()
    }

    const view = await this.submissionService.start({
      organizationId: distribution.organizationId,
      tenantId: distribution.tenantId,
      formKey: form.key,
      subjectType: 'forms_invitation',
      subjectId: invitation.id,
      startedBy: invitation.id,
      initialRole: invitation.role ?? null,
      pinnedVersionId: distribution.pinnedVersionId ?? undefined,
    })

    const now = this.now()
    invitation.submissionId = view.submission.id
    invitation.status = 'started'
    invitation.startedAt = now
    if (!invitation.locale) invitation.locale = args.locale ?? distribution.defaultLocale ?? null
    await em.flush()

    const role = view.actors[0]?.role ?? invitation.role ?? null
    return this.issueAccess(view, invitation, role)
  }

  // --------------------------------------------------------------------------
  // Reserve a response slot (atomic cap enforcement — R-2d-5)
  // --------------------------------------------------------------------------

  async reserveResponseSlot(args: { distributionId: string; organizationId: string; tenantId: string }): Promise<void> {
    const em = this.emFactory()
    await em.transactional(async (trx) => {
      const distribution = await trx.findOne(
        FormDistribution,
        {
          id: args.distributionId,
          organizationId: args.organizationId,
          tenantId: args.tenantId,
          deletedAt: null,
        },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      )
      if (!distribution) {
        throw new DistributionServiceError('NOT_FOUND', 'Distribution not found.', 404)
      }
      this.assertDistributionAvailable(distribution)
      distribution.responseCount += 1
      await trx.flush()
    })
  }

  // --------------------------------------------------------------------------
  // Mark invitation submitted
  // --------------------------------------------------------------------------

  async markInvitationSubmitted(args: {
    invitationId: string
    organizationId: string
    tenantId: string
    submissionId: string
  }): Promise<void> {
    const em = this.emFactory()
    const invitation = await em.findOne(FormInvitation, {
      id: args.invitationId,
      organizationId: args.organizationId,
      tenantId: args.tenantId,
      deletedAt: null,
    })
    if (!invitation) {
      throw new DistributionServiceError('NOT_FOUND', 'Invitation not found.', 404)
    }
    invitation.status = 'submitted'
    invitation.submittedAt = this.now()
    await em.flush()
    await this.safeEmit('forms.invitation.submitted', {
      invitationId: invitation.id,
      submissionId: args.submissionId,
    })
  }

  // --------------------------------------------------------------------------
  // Slide the access-token expiry (used by the autosave route)
  // --------------------------------------------------------------------------

  refreshAccessToken(submissionId: string, invitationId: string, role: string | null): string {
    return signAccessToken({
      submissionId,
      invitationId,
      role,
      expiresAtSeconds: this.expiresAtSeconds(),
    })
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private async resumeExisting(
    distribution: FormDistribution,
    formKey: string,
    invitation: FormInvitation,
  ): Promise<BeginAnonymousResult> {
    const view = await this.submissionService.getCurrent({
      organizationId: invitation.organizationId,
      tenantId: invitation.tenantId,
      submissionId: invitation.submissionId as string,
      viewerRole: invitation.role ?? null,
      viewerUserId: invitation.id,
    })
    void distribution
    void formKey
    const role = view.actors.find((actor) => actor.userId === invitation.id)?.role
      ?? invitation.role
      ?? view.actors[0]?.role
      ?? null
    return this.issueAccess(view, invitation, role)
  }

  private issueAccess(
    view: SubmissionViewModel,
    invitation: FormInvitation,
    role: string | null,
  ): BeginAnonymousResult {
    const expiresAtSeconds = this.expiresAtSeconds()
    const accessToken = signAccessToken({
      submissionId: view.submission.id,
      invitationId: invitation.id,
      role,
      expiresAtSeconds,
    })
    return {
      view,
      invitation,
      accessToken,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    }
  }

  private expiresAtSeconds(): number {
    return Math.floor(this.now().getTime() / 1000) + getAccessTokenTtlSeconds()
  }

  private assertDistributionAvailable(distribution: FormDistribution): void {
    if (distribution.status !== 'active') {
      throw new DistributionServiceError('GONE', 'Distribution is not active.', 410, {
        status: distribution.status,
      })
    }
    const now = this.now().getTime()
    if (distribution.opensAt && now < distribution.opensAt.getTime()) {
      throw new DistributionServiceError('GONE', 'Distribution is not open yet.', 410)
    }
    if (distribution.closesAt && now > distribution.closesAt.getTime()) {
      throw new DistributionServiceError('GONE', 'Distribution is closed.', 410)
    }
    if (distribution.maxResponses != null && distribution.responseCount >= distribution.maxResponses) {
      throw new DistributionServiceError('GONE', 'Distribution response cap reached.', 410)
    }
  }

  private assertInvitationUsable(invitation: FormInvitation): void {
    if (INVITATION_TERMINAL_STATUSES.has(invitation.status)) {
      throw new DistributionServiceError('GONE', `Invitation is ${invitation.status}.`, 410, {
        status: invitation.status,
      })
    }
    if (invitation.expiresAt && this.now().getTime() > invitation.expiresAt.getTime()) {
      throw new DistributionServiceError('GONE', 'Invitation is expired.', 410)
    }
  }

  private async safeEmit<K extends keyof DistributionEvents>(
    eventId: K,
    payload: DistributionEvents[K],
  ): Promise<void> {
    try {
      await this.emitEvent(eventId, payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown emit error'
      this.logger.warn(
        { event: 'forms.distribution.event_emit_failed', eventId, message },
        'forms distribution event emission failed',
      )
    }
  }
}

