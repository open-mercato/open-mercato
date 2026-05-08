/**
 * Forms module SubmissionService — owns the start/save/submit lifecycle.
 *
 * Critical invariants enforced here:
 *  - Append-only revision chain (only allowed UPDATE paths are anonymize
 *    in phase 2b and the coalesce-after-cap branch in this file).
 *  - Tenant-scoped queries on every read/write.
 *  - Server-derived `saved_by_role` from active actor row — never read from
 *    client input.
 *  - Optimistic concurrency via `base_revision_id`.
 *  - Tampering markers logged when patches contain non-editable field keys.
 *  - Per-tenant envelope encryption of revision payloads.
 *
 * The service is intentionally thin on cross-cutting concerns: emit hooks
 * are exposed via `eventEmitter` and pluggable audit-access logger
 * (`auditAccess`) so phase 2b can replace it without rewriting the service.
 */

import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import {
  Form,
  FormSubmission,
  FormSubmissionActor,
  FormSubmissionRevision,
  FormVersion,
} from '../data/entities'
import {
  FormVersionCompiler,
  type CompiledFormVersion,
} from './form-version-compiler'
import type { EncryptionService } from './encryption-service'
import { RolePolicyService } from './role-policy-service'
import { buildTamperingMarker, type StructuredLogger } from '../lib/log-redaction'
import { formsEventPayloadSchemas } from '../events-payloads'

const DEFAULT_AUTOSAVE_INTERVAL_MS = (() => {
  const raw = process.env.FORMS_AUTOSAVE_INTERVAL_MS
  if (!raw) return 10_000
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000
})()

const DEFAULT_REVISION_CAP = (() => {
  const raw = process.env.FORMS_REVISION_CAP
  if (!raw) return 10_000
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000
})()

export type SubmissionServiceErrorCode =
  | 'STALE_BASE'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'NO_ACTOR'
  | 'INVALID_STATUS'
  | 'INVALID_ROLE'
  | 'FORM_INACTIVE'
  | 'FORM_VERSION_NOT_PUBLISHED'

export class SubmissionServiceError extends Error {
  readonly code: SubmissionServiceErrorCode
  readonly httpStatus: number
  readonly details?: Record<string, unknown>

  constructor(code: SubmissionServiceErrorCode, message: string, httpStatus: number, details?: Record<string, unknown>) {
    super(message)
    this.name = 'SubmissionServiceError'
    this.code = code
    this.httpStatus = httpStatus
    this.details = details
  }
}

type Scope = {
  tenantId: string
  organizationId: string
}

export type StartArgs = Scope & {
  formKey: string
  subjectType: string
  subjectId: string
  startedBy: string
  /** Optional initial role override — when present, MUST be in form_version.roles. */
  initialRole?: string | null
}

export type SaveArgs = Scope & {
  submissionId: string
  baseRevisionId: string
  patch: Record<string, unknown>
  savedBy: string
  changeSummary?: string | null
  changeSource?: 'user' | 'admin' | 'system'
}

export type SubmitArgs = Scope & {
  submissionId: string
  baseRevisionId: string
  submittedBy: string
  submitMetadata?: Record<string, unknown> | null
}

export type ReopenArgs = Scope & {
  submissionId: string
  reopenedBy: string
}

export type AssignActorArgs = Scope & {
  submissionId: string
  userId: string
  role: string
  assignedBy: string
}

export type RevokeActorArgs = Scope & {
  submissionId: string
  actorId: string
  revokedBy: string
}

export type GetCurrentArgs = Scope & {
  submissionId: string
  /** When provided, slice the response to only this role's visible fields. */
  viewerRole?: string | null
  /** User reading — used for audit log call site (no-op until phase 2b). */
  viewerUserId?: string | null
}

export type SubmissionViewModel = {
  submission: FormSubmission
  revision: FormSubmissionRevision
  decodedData: Record<string, unknown>
  actors: FormSubmissionActor[]
  formVersion: FormVersion
}

export type RevisionInsertOutcome = {
  revision: FormSubmissionRevision
  coalesced: boolean
}

export type SubmissionEvents = {
  'forms.submission.started': (payload: z.infer<typeof formsEventPayloadSchemas['forms.submission.started']>) => Promise<void> | void
  'forms.submission.revision_appended': (payload: z.infer<typeof formsEventPayloadSchemas['forms.submission.revision_appended']>) => Promise<void> | void
  'forms.submission.submitted': (payload: z.infer<typeof formsEventPayloadSchemas['forms.submission.submitted']>) => Promise<void> | void
  'forms.submission.reopened': (payload: z.infer<typeof formsEventPayloadSchemas['forms.submission.reopened']>) => Promise<void> | void
  'forms.submission.actor_assigned': (payload: z.infer<typeof formsEventPayloadSchemas['forms.submission.actor_assigned']>) => Promise<void> | void
}

export type AuditAccessHook = (args: {
  submissionId: string
  organizationId: string
  tenantId: string
  viewerUserId: string | null
  viewerRole: string | null
  surface: 'admin' | 'runtime'
  scope: 'submission' | 'revision'
}) => Promise<void> | void

export type SubmissionServiceOptions = {
  emFactory: () => EntityManager
  formVersionCompiler: FormVersionCompiler
  encryptionService: EncryptionService
  rolePolicyService: RolePolicyService
  /** Pluggable event emitter — wires to the typed forms events catalog. */
  emitEvent: <K extends keyof SubmissionEvents>(eventId: K, payload: Parameters<SubmissionEvents[K]>[0]) => Promise<void> | void
  /** Phase 2b replaces this with a real audit logger. Phase 1c uses a no-op. */
  auditAccess?: AuditAccessHook
  logger?: StructuredLogger
  /** Override the clock for tests. */
  now?: () => Date
  autosaveIntervalMs?: number
  revisionCap?: number
}

const noopAuditAccess: AuditAccessHook = () => {}

const noopLogger: StructuredLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

export class SubmissionService {
  private readonly emFactory: () => EntityManager
  private readonly compiler: FormVersionCompiler
  private readonly encryption: EncryptionService
  private readonly rolePolicy: RolePolicyService
  private readonly emitEvent: SubmissionServiceOptions['emitEvent']
  private readonly auditAccess: AuditAccessHook
  private readonly logger: StructuredLogger
  private readonly now: () => Date
  private readonly autosaveIntervalMs: number
  private readonly revisionCap: number

  constructor(options: SubmissionServiceOptions) {
    this.emFactory = options.emFactory
    this.compiler = options.formVersionCompiler
    this.encryption = options.encryptionService
    this.rolePolicy = options.rolePolicyService
    this.emitEvent = options.emitEvent
    this.auditAccess = options.auditAccess ?? noopAuditAccess
    this.logger = options.logger ?? noopLogger
    this.now = options.now ?? (() => new Date())
    this.autosaveIntervalMs = options.autosaveIntervalMs ?? DEFAULT_AUTOSAVE_INTERVAL_MS
    this.revisionCap = options.revisionCap ?? DEFAULT_REVISION_CAP
  }

  // --------------------------------------------------------------------------
  // Active form-version lookup
  // --------------------------------------------------------------------------

  async getActiveFormVersionByKey(args: Scope & { formKey: string }): Promise<{
    form: Form
    formVersion: FormVersion
    compiled: CompiledFormVersion
  }> {
    const em = this.emFactory()
    const form = await em.findOne(Form, {
      organizationId: args.organizationId,
      tenantId: args.tenantId,
      key: args.formKey,
      deletedAt: null,
    })
    if (!form) {
      throw new SubmissionServiceError('NOT_FOUND', `Form "${args.formKey}" not found.`, 404)
    }
    if (form.status !== 'active') {
      throw new SubmissionServiceError('FORM_INACTIVE', `Form "${args.formKey}" is not active.`, 422)
    }
    if (!form.currentPublishedVersionId) {
      throw new SubmissionServiceError(
        'FORM_VERSION_NOT_PUBLISHED',
        `Form "${args.formKey}" has no published version.`,
        422,
      )
    }
    const formVersion = await em.findOne(FormVersion, {
      id: form.currentPublishedVersionId,
      organizationId: args.organizationId,
      tenantId: args.tenantId,
    })
    if (!formVersion) {
      throw new SubmissionServiceError('NOT_FOUND', 'Pinned form version not found.', 404)
    }
    const compiled = this.compiler.compile({
      id: formVersion.id,
      updatedAt: formVersion.updatedAt,
      schema: formVersion.schema,
      uiSchema: formVersion.uiSchema,
    })
    return { form, formVersion, compiled }
  }

  // --------------------------------------------------------------------------
  // Lifecycle: start
  // --------------------------------------------------------------------------

  async start(args: StartArgs): Promise<SubmissionViewModel> {
    const { form, formVersion, compiled } = await this.getActiveFormVersionByKey({
      tenantId: args.tenantId,
      organizationId: args.organizationId,
      formKey: args.formKey,
    })
    const declaredRoles = readDeclaredRoles(formVersion)
    const role = args.initialRole
      ?? readDefaultActorRole(formVersion)
      ?? declaredRoles[0]
      ?? null
    if (!role) {
      throw new SubmissionServiceError('INVALID_ROLE', 'Form version does not declare any roles.', 422)
    }
    if (!declaredRoles.includes(role) && role !== 'admin') {
      throw new SubmissionServiceError('INVALID_ROLE', `Role "${role}" is not declared on the form version.`, 422)
    }

    const em = this.emFactory()
    const result = await em.transactional(async (trx) => {
      const now = this.now()
      const submission = trx.create(FormSubmission, {
        organizationId: args.organizationId,
        tenantId: args.tenantId,
        formVersionId: formVersion.id,
        subjectType: args.subjectType,
        subjectId: args.subjectId,
        status: 'draft',
        startedBy: args.startedBy,
        firstSavedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      trx.persist(submission)

      const actor = trx.create(FormSubmissionActor, {
        submissionId: submission.id,
        organizationId: args.organizationId,
        userId: args.startedBy,
        role,
        assignedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      trx.persist(actor)

      const initialPayload: Record<string, unknown> = {}
      const ciphertext = await this.encryption.encrypt(
        args.organizationId,
        Buffer.from(JSON.stringify(initialPayload), 'utf8'),
      )
      const keyVersion = await this.encryption.currentKeyVersion(args.organizationId)
      const revision = trx.create(FormSubmissionRevision, {
        submissionId: submission.id,
        organizationId: args.organizationId,
        revisionNumber: 1,
        data: ciphertext,
        encryptionKeyVersion: keyVersion,
        savedAt: now,
        savedBy: args.startedBy,
        savedByRole: role,
        changeSource: 'system',
        changedFieldKeys: [],
        changeSummary: null,
      })
      trx.persist(revision)

      submission.currentRevisionId = revision.id
      await trx.flush()

      return { submission, actor, revision }
    })

    await this.safeEmit('forms.submission.started', {
      submissionId: result.submission.id,
      formVersionId: formVersion.id,
    })

    return {
      submission: result.submission,
      revision: result.revision,
      decodedData: this.rolePolicy.resolve(compiled, role).sliceReadPayload({}),
      actors: [result.actor],
      formVersion,
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle: save
  // --------------------------------------------------------------------------

  async save(args: SaveArgs): Promise<RevisionInsertOutcome> {
    const em = this.emFactory()
    const result = await em.transactional(async (trx) => {
      const submission = await trx.findOne(
        FormSubmission,
        {
          id: args.submissionId,
          organizationId: args.organizationId,
          tenantId: args.tenantId,
          deletedAt: null,
        },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      )
      if (!submission) {
        throw new SubmissionServiceError('NOT_FOUND', 'Submission not found.', 404)
      }
      if (submission.status === 'archived') {
        throw new SubmissionServiceError('INVALID_STATUS', 'Submission is archived.', 422)
      }

      const formVersion = await trx.findOne(FormVersion, {
        id: submission.formVersionId,
        organizationId: args.organizationId,
        tenantId: args.tenantId,
      })
      if (!formVersion) {
        throw new SubmissionServiceError('NOT_FOUND', 'Form version not found.', 404)
      }

      // Active actor for this user
      const actor = await trx.findOne(FormSubmissionActor, {
        submissionId: submission.id,
        organizationId: args.organizationId,
        userId: args.savedBy,
        revokedAt: null,
        deletedAt: null,
      })
      if (!actor) {
        throw new SubmissionServiceError('NO_ACTOR', 'No active actor row for this user on this submission.', 403)
      }

      // Optimistic concurrency
      if (submission.currentRevisionId !== args.baseRevisionId) {
        throw new SubmissionServiceError('STALE_BASE', 'base_revision_id is stale.', 409, {
          currentRevisionId: submission.currentRevisionId,
        })
      }

      const currentRevision = await trx.findOne(FormSubmissionRevision, {
        id: args.baseRevisionId,
        submissionId: submission.id,
        organizationId: args.organizationId,
      })
      if (!currentRevision) {
        throw new SubmissionServiceError('NOT_FOUND', 'Base revision not found.', 404)
      }

      // Rate limit (skip for system change source). When autosaveIntervalMs
      // is configured to 0 the rate limit is disabled — useful in tests.
      const changeSource = args.changeSource ?? 'user'
      if (changeSource !== 'system' && this.autosaveIntervalMs > 0) {
        const minIntervalMs = Math.floor(this.autosaveIntervalMs / 2)
        if (minIntervalMs > 0) {
          const elapsed = this.now().getTime() - currentRevision.savedAt.getTime()
          if (elapsed < minIntervalMs) {
            throw new SubmissionServiceError('RATE_LIMITED', 'Save rate limit exceeded.', 429, {
              retryAfterMs: minIntervalMs - elapsed,
            })
          }
        }
      }

      // Compile schema + filter patch by role
      const compiled = this.compiler.compile({
        id: formVersion.id,
        updatedAt: formVersion.updatedAt,
        schema: formVersion.schema,
        uiSchema: formVersion.uiSchema,
      })
      const policy = this.rolePolicy.resolve(compiled, actor.role)
      const { accepted, droppedFieldKeys } = policy.filterWritePatch(args.patch)
      if (droppedFieldKeys.length > 0) {
        this.logger.warn(
          buildTamperingMarker({
            submissionId: submission.id,
            userId: args.savedBy,
            role: actor.role,
            droppedFieldKeys,
          }),
          'Forms tampering marker — fields outside actor editable set were dropped.',
        )
      }

      // Decrypt + merge
      const priorPlain = await this.decodeRevision(args.organizationId, currentRevision)
      const merged: Record<string, unknown> = { ...priorPlain }
      for (const [key, value] of Object.entries(accepted)) {
        if (value === null || value === undefined) {
          delete merged[key]
        } else {
          merged[key] = value
        }
      }

      // Validate merged payload
      const ajvValid = compiled.ajv(merged)
      if (!ajvValid) {
        const errors = Array.isArray(compiled.ajv.errors) ? compiled.ajv.errors : []
        throw new SubmissionServiceError('VALIDATION_FAILED', 'Merged payload failed validation.', 422, {
          errors: errors.map((err) => ({
            instancePath: err.instancePath,
            keyword: err.keyword,
            message: err.message,
            params: err.params,
          })),
        })
      }

      // Compute changed field keys vs prior
      const changedFieldKeys = computeChangedFieldKeys(priorPlain, merged)

      // Encrypt merged payload
      const ciphertext = await this.encryption.encrypt(
        args.organizationId,
        Buffer.from(JSON.stringify(merged), 'utf8'),
      )
      const keyVersion = await this.encryption.currentKeyVersion(args.organizationId)

      const nextRevisionNumber = currentRevision.revisionNumber + 1
      const coalesce = nextRevisionNumber > this.revisionCap
      let outcome: RevisionInsertOutcome
      if (coalesce) {
        // Coalesce-after-cap: UPDATE the latest revision in place. The only
        // UPDATE path other than anonymize. Bump saved_at, replace data,
        // accumulate changedFieldKeys, force changeSource = 'system'.
        currentRevision.data = ciphertext
        currentRevision.encryptionKeyVersion = keyVersion
        currentRevision.savedAt = this.now()
        currentRevision.savedBy = args.savedBy
        currentRevision.savedByRole = actor.role
        currentRevision.changeSource = 'system'
        currentRevision.changedFieldKeys = uniqueStrings([
          ...(currentRevision.changedFieldKeys ?? []),
          ...changedFieldKeys,
        ])
        if (typeof args.changeSummary === 'string') currentRevision.changeSummary = args.changeSummary
        submission.updatedAt = this.now()
        await trx.flush()
        outcome = { revision: currentRevision, coalesced: true }
      } else {
        const savedAt = this.now()
        const revision = trx.create(FormSubmissionRevision, {
          submissionId: submission.id,
          organizationId: args.organizationId,
          revisionNumber: nextRevisionNumber,
          data: ciphertext,
          encryptionKeyVersion: keyVersion,
          savedAt,
          savedBy: args.savedBy,
          savedByRole: actor.role,
          changeSource,
          changedFieldKeys,
          changeSummary: args.changeSummary ?? null,
        })
        trx.persist(revision)
        submission.currentRevisionId = revision.id
        submission.updatedAt = this.now()
        await trx.flush()
        outcome = { revision, coalesced: false }
      }

      return {
        outcome,
        savedByRole: actor.role,
      }
    })

    await this.safeEmit('forms.submission.revision_appended', {
      submissionId: args.submissionId,
      revisionId: result.outcome.revision.id,
      savedBy: args.savedBy,
      savedByRole: result.savedByRole,
      changedFieldKeys: result.outcome.revision.changedFieldKeys ?? [],
    })

    return result.outcome
  }

  // --------------------------------------------------------------------------
  // Lifecycle: submit
  // --------------------------------------------------------------------------

  async submit(args: SubmitArgs): Promise<FormSubmission> {
    const em = this.emFactory()
    const result = await em.transactional(async (trx) => {
      const submission = await trx.findOne(
        FormSubmission,
        {
          id: args.submissionId,
          organizationId: args.organizationId,
          tenantId: args.tenantId,
          deletedAt: null,
        },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      )
      if (!submission) {
        throw new SubmissionServiceError('NOT_FOUND', 'Submission not found.', 404)
      }
      if (submission.status === 'submitted') {
        throw new SubmissionServiceError('INVALID_STATUS', 'Submission already submitted.', 422)
      }
      if (submission.status === 'archived') {
        throw new SubmissionServiceError('INVALID_STATUS', 'Submission is archived.', 422)
      }
      if (submission.currentRevisionId !== args.baseRevisionId) {
        throw new SubmissionServiceError('STALE_BASE', 'base_revision_id is stale.', 409, {
          currentRevisionId: submission.currentRevisionId,
        })
      }
      submission.status = 'submitted'
      submission.submittedAt = this.now()
      submission.submittedBy = args.submittedBy
      if (args.submitMetadata) submission.submitMetadata = args.submitMetadata
      await trx.flush()
      return submission
    })

    await this.safeEmit('forms.submission.submitted', { submissionId: result.id })
    return result
  }

  // --------------------------------------------------------------------------
  // Lifecycle: reopen
  // --------------------------------------------------------------------------

  async reopen(args: ReopenArgs): Promise<FormSubmission> {
    const em = this.emFactory()
    const result = await em.transactional(async (trx) => {
      const submission = await trx.findOne(
        FormSubmission,
        {
          id: args.submissionId,
          organizationId: args.organizationId,
          tenantId: args.tenantId,
          deletedAt: null,
        },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      )
      if (!submission) {
        throw new SubmissionServiceError('NOT_FOUND', 'Submission not found.', 404)
      }
      if (submission.status !== 'submitted') {
        throw new SubmissionServiceError('INVALID_STATUS', 'Only submitted submissions can be reopened.', 422)
      }
      submission.status = 'reopened'
      submission.submittedAt = null
      submission.submittedBy = null
      await trx.flush()
      return submission
    })
    await this.safeEmit('forms.submission.reopened', { submissionId: result.id })
    return result
  }

  // --------------------------------------------------------------------------
  // Actors
  // --------------------------------------------------------------------------

  async assignActor(args: AssignActorArgs): Promise<FormSubmissionActor> {
    const em = this.emFactory()
    const submission = await em.findOne(FormSubmission, {
      id: args.submissionId,
      organizationId: args.organizationId,
      tenantId: args.tenantId,
      deletedAt: null,
    })
    if (!submission) {
      throw new SubmissionServiceError('NOT_FOUND', 'Submission not found.', 404)
    }
    const formVersion = await em.findOne(FormVersion, {
      id: submission.formVersionId,
      organizationId: args.organizationId,
      tenantId: args.tenantId,
    })
    if (!formVersion) {
      throw new SubmissionServiceError('NOT_FOUND', 'Form version not found.', 404)
    }
    const declaredRoles = readDeclaredRoles(formVersion)
    if (args.role !== 'admin' && !declaredRoles.includes(args.role)) {
      throw new SubmissionServiceError('INVALID_ROLE', `Role "${args.role}" is not declared on the form version.`, 422)
    }
    const existing = await em.findOne(FormSubmissionActor, {
      submissionId: submission.id,
      organizationId: args.organizationId,
      userId: args.userId,
      revokedAt: null,
      deletedAt: null,
    })
    if (existing) {
      if (existing.role === args.role) return existing
      // Different role on the same user — revoke the previous assignment.
      existing.revokedAt = this.now()
      em.persist(existing)
    }
    const nowDate = this.now()
    const actor = em.create(FormSubmissionActor, {
      submissionId: submission.id,
      organizationId: args.organizationId,
      userId: args.userId,
      role: args.role,
      assignedAt: nowDate,
      createdAt: nowDate,
      updatedAt: nowDate,
    })
    em.persist(actor)
    await em.flush()
    await this.safeEmit('forms.submission.actor_assigned', {
      submissionId: submission.id,
      userId: args.userId,
      role: args.role,
    })
    return actor
  }

  async revokeActor(args: RevokeActorArgs): Promise<void> {
    const em = this.emFactory()
    const actor = await em.findOne(FormSubmissionActor, {
      id: args.actorId,
      organizationId: args.organizationId,
      submissionId: args.submissionId,
      deletedAt: null,
    })
    if (!actor) {
      throw new SubmissionServiceError('NOT_FOUND', 'Actor row not found.', 404)
    }
    if (actor.revokedAt) return
    actor.revokedAt = this.now()
    em.persist(actor)
    await em.flush()
  }

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async getCurrent(args: GetCurrentArgs): Promise<SubmissionViewModel> {
    const em = this.emFactory()
    const submission = await em.findOne(FormSubmission, {
      id: args.submissionId,
      organizationId: args.organizationId,
      tenantId: args.tenantId,
      deletedAt: null,
    })
    if (!submission) {
      throw new SubmissionServiceError('NOT_FOUND', 'Submission not found.', 404)
    }
    const formVersion = await em.findOne(FormVersion, {
      id: submission.formVersionId,
      organizationId: args.organizationId,
      tenantId: args.tenantId,
    })
    if (!formVersion) {
      throw new SubmissionServiceError('NOT_FOUND', 'Form version not found.', 404)
    }
    const revision = submission.currentRevisionId
      ? await em.findOne(FormSubmissionRevision, {
          id: submission.currentRevisionId,
          submissionId: submission.id,
          organizationId: args.organizationId,
        })
      : null
    if (!revision) {
      throw new SubmissionServiceError('NOT_FOUND', 'Current revision not found.', 404)
    }
    const actors = await em.find(FormSubmissionActor, {
      submissionId: submission.id,
      organizationId: args.organizationId,
      deletedAt: null,
    })

    const compiled = this.compiler.compile({
      id: formVersion.id,
      updatedAt: formVersion.updatedAt,
      schema: formVersion.schema,
      uiSchema: formVersion.uiSchema,
    })
    const decodedFull = await this.decodeRevision(args.organizationId, revision)
    const decodedData = args.viewerRole
      ? this.rolePolicy.resolve(compiled, args.viewerRole).sliceReadPayload(decodedFull)
      : decodedFull

    // TODO(forms-2b): write form_access_audit row via auditAccess hook.
    await this.auditAccess({
      submissionId: submission.id,
      organizationId: args.organizationId,
      tenantId: args.tenantId,
      viewerUserId: args.viewerUserId ?? null,
      viewerRole: args.viewerRole ?? null,
      surface: 'runtime',
      scope: 'submission',
    })

    return {
      submission,
      revision,
      decodedData,
      actors,
      formVersion,
    }
  }

  async listRevisions(args: Scope & { submissionId: string; viewerUserId?: string | null; viewerRole?: string | null }): Promise<{
    submission: FormSubmission
    revisions: FormSubmissionRevision[]
  }> {
    const em = this.emFactory()
    const submission = await em.findOne(FormSubmission, {
      id: args.submissionId,
      organizationId: args.organizationId,
      tenantId: args.tenantId,
      deletedAt: null,
    })
    if (!submission) {
      throw new SubmissionServiceError('NOT_FOUND', 'Submission not found.', 404)
    }
    const revisions = await em.find(
      FormSubmissionRevision,
      { submissionId: submission.id, organizationId: args.organizationId },
      { orderBy: { revisionNumber: 'asc' } },
    )

    // TODO(forms-2b): write form_access_audit row via auditAccess hook.
    await this.auditAccess({
      submissionId: submission.id,
      organizationId: args.organizationId,
      tenantId: args.tenantId,
      viewerUserId: args.viewerUserId ?? null,
      viewerRole: args.viewerRole ?? null,
      surface: 'admin',
      scope: 'revision',
    })

    return { submission, revisions }
  }

  async listSubmissionsBySubject(args: Scope & { subjectType: string; subjectId: string }): Promise<FormSubmission[]> {
    const em = this.emFactory()
    return em.find(
      FormSubmission,
      {
        organizationId: args.organizationId,
        tenantId: args.tenantId,
        subjectType: args.subjectType,
        subjectId: args.subjectId,
        deletedAt: null,
      },
      { orderBy: { firstSavedAt: 'desc' } },
    )
  }

  async listSubmissionsByForm(args: Scope & {
    formId: string
    page: number
    pageSize: number
    status?: string
  }): Promise<{ items: FormSubmission[]; total: number; page: number; pageSize: number }> {
    const em = this.emFactory()
    const where: Record<string, unknown> = {
      organizationId: args.organizationId,
      tenantId: args.tenantId,
      deletedAt: null,
    }
    if (args.status) where.status = args.status
    // Filter by all versions belonging to the form
    const versions = await em.find(FormVersion, {
      formId: args.formId,
      organizationId: args.organizationId,
      tenantId: args.tenantId,
    })
    const versionIds = versions.map((v) => v.id)
    if (versionIds.length === 0) {
      return { items: [], total: 0, page: args.page, pageSize: args.pageSize }
    }
    where.formVersionId = { $in: versionIds }
    const offset = Math.max(0, (args.page - 1) * args.pageSize)
    const [items, total] = await em.findAndCount<FormSubmission>(
      FormSubmission,
      where as never,
      {
        orderBy: { firstSavedAt: 'desc' },
        limit: args.pageSize,
        offset,
      },
    )
    return { items, total, page: args.page, pageSize: args.pageSize }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private async decodeRevision(
    organizationId: string,
    revision: FormSubmissionRevision,
  ): Promise<Record<string, unknown>> {
    const ciphertext = ensureBuffer(revision.data)
    if (ciphertext.length === 0) return {}
    const plain = await this.encryption.decrypt(organizationId, ciphertext)
    if (plain.length === 0) return {}
    try {
      return JSON.parse(plain.toString('utf8'))
    } catch {
      return {}
    }
  }

  private async safeEmit<K extends keyof SubmissionEvents>(
    eventId: K,
    payload: Parameters<SubmissionEvents[K]>[0],
  ): Promise<void> {
    try {
      await this.emitEvent(eventId, payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown emit error'
      this.logger.warn({ event: 'forms.submission.event_emit_failed', eventId, message }, 'forms event emission failed')
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function ensureBuffer(value: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') return Buffer.from(value, 'binary')
  return Buffer.alloc(0)
}

function readDeclaredRoles(formVersion: FormVersion): string[] {
  const roles = formVersion.roles
  if (Array.isArray(roles)) {
    return roles.filter((entry): entry is string => typeof entry === 'string')
  }
  // Fallback: read from schema
  const fromSchema = (formVersion.schema as Record<string, unknown> | null | undefined)?.['x-om-roles']
  if (Array.isArray(fromSchema)) {
    return fromSchema.filter((entry): entry is string => typeof entry === 'string')
  }
  return []
}

function readDefaultActorRole(formVersion: FormVersion): string | null {
  const value = (formVersion.schema as Record<string, unknown> | null | undefined)?.['x-om-default-actor-role']
  return typeof value === 'string' && value.length > 0 ? value : null
}

function computeChangedFieldKeys(
  prior: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  const keys = new Set<string>([...Object.keys(prior), ...Object.keys(next)])
  const changed: string[] = []
  for (const key of keys) {
    const a = prior[key]
    const b = next[key]
    if (!deepEqual(a, b)) changed.push(key)
  }
  return changed
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    return a.every((entry, index) => deepEqual(entry, b[index]))
  }
  const aKeys = Object.keys(a as Record<string, unknown>)
  const bKeys = Object.keys(b as Record<string, unknown>)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}
