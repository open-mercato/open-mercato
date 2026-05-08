import { asValue, asFunction } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { defaultFieldTypeRegistry } from './schema/field-type-registry'
import { FormVersionCompiler } from './services/form-version-compiler'
import { FormVersionDiffer } from './services/form-version-differ'
import {
  FormsEncryptionService,
  type EncryptionService,
} from './services/encryption-service'
import { RolePolicyService } from './services/role-policy-service'
import { SubmissionService } from './services/submission-service'
import {
  AccessAuditLogger,
  FormsAccessAuditLogger,
  type AccessAuditEvent,
} from './services/access-audit-logger'
import { AnonymizeService } from './services/anonymize-service'
import { emitFormsEvent } from './events'
import { formsEventPayloadSchemas } from './events-payloads'

/**
 * Forms module DI registrar.
 *
 * Registered keys (FROZEN — root AGENTS.md § BC contract § 9):
 * - `fieldTypeRegistry` (1a) → singleton FieldTypeRegistry preloaded with the
 *    11 v1 core field types.
 * - `formVersionCompiler` (1a) → singleton FormVersionCompiler bound to the
 *    same registry. Phases 1b/1c/1d resolve this to compile draft and
 *    published form versions for AJV/Zod validation and role policy.
 * - `formVersionDiffer` (1b) → singleton pure-function FormVersionDiffer.
 *    Consumes compiled `fieldIndex` maps to produce added/removed/modified
 *    field-level diffs for the publish dialog and version history modal.
 * - `formsEncryptionService` (1c) → per-tenant envelope encryption service
 *    used by SubmissionService for revision payloads.
 * - `formsRolePolicyService` (1c) → resolver over compiled form versions for
 *    role-aware read/write decisions.
 * - `formsSubmissionService` (1c) → owns the submission lifecycle.
 *    Lazy-resolves `em` per request from the container so EntityManager
 *    request scoping is honoured.
 */
export function register(container: AppContainer): void {
  const formVersionCompiler = new FormVersionCompiler({ registry: defaultFieldTypeRegistry })
  const formVersionDiffer = new FormVersionDiffer()
  const rolePolicyService = new RolePolicyService()

  const accessAuditLogger: AccessAuditLogger = new FormsAccessAuditLogger()

  container.register({
    fieldTypeRegistry: asValue(defaultFieldTypeRegistry),
    formVersionCompiler: asValue(formVersionCompiler),
    formVersionDiffer: asValue(formVersionDiffer),
    formsRolePolicyService: asValue(rolePolicyService),
    formsAccessAuditLogger: asValue(accessAuditLogger),
    formsEncryptionService: asFunction((deps: Record<string, unknown>): EncryptionService => {
      return new FormsEncryptionService({
        emFactory: () => deps.em as EntityManager,
      })
    }).singleton(),
    formsSubmissionService: asFunction((deps: Record<string, unknown>): SubmissionService => {
      const em = deps.em as EntityManager
      return new SubmissionService({
        emFactory: () => em,
        formVersionCompiler,
        encryptionService: deps.formsEncryptionService as EncryptionService,
        rolePolicyService,
        emitEvent: async (eventId, payload) => {
          // Validate against catalogued payload schema before forwarding to the
          // global event bus. Keeps the event contract tight per AGENTS.md.
          const schema = formsEventPayloadSchemas[eventId as keyof typeof formsEventPayloadSchemas]
          const validated = schema ? schema.parse(payload) : payload
          await emitFormsEvent(eventId, validated as never)
        },
        auditAccess: async (args) => {
          // Phase 2b — replaces the no-op hook from phase 1c. Writes one
          // row per admin-surface read/mutation. Runtime patient reads
          // bypass this hook by calling with `surface = 'runtime'` (R1 posture).
          if (args.surface !== 'admin') return
          if (!args.viewerUserId) return
          const event: AccessAuditEvent = {
            organizationId: args.organizationId,
            submissionId: args.submissionId,
            accessedBy: args.viewerUserId,
            accessPurpose: 'view',
          }
          await accessAuditLogger.log(em, event)
        },
      })
    }).singleton(),
    formsAnonymizeService: asFunction((deps: Record<string, unknown>): AnonymizeService => {
      return new AnonymizeService({
        em: deps.em as EntityManager,
        compiler: formVersionCompiler,
        encryption: deps.formsEncryptionService as EncryptionService,
      })
    }).singleton(),
  })
}
