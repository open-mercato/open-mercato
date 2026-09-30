import { asValue, asFunction } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { getOrm } from '@open-mercato/shared/lib/db/mikro'
import { defaultFieldTypeRegistry } from './schema/field-type-registry'
import { FormVersionCompiler } from './services/form-version-compiler'
import { FormVersionDiffer } from './services/form-version-differ'
import {
  FormsEncryptionService,
  resolveKmsAdapter,
  type EncryptionService,
} from './services/encryption-service'
import { RolePolicyService } from './services/role-policy-service'
import { SubmissionService } from './services/submission-service'
import { DistributionService } from './services/distribution-service'
import {
  AccessAuditLogger,
  BatchingAccessAuditLogger,
  FormsAccessAuditLogger,
  resolveAccessAuditBatchMs,
  type AccessAuditEvent,
} from './services/access-audit-logger'
import { AnonymizeService } from './services/anonymize-service'
import { AnalyticsService } from './services/analytics-service'
import { ConsentRecordService } from './services/consent-record-service'
import { ExportService } from './services/export-service'
import { AttachmentService } from './services/attachment-service'
import { PdfSnapshotService } from './services/pdf-snapshot-service'
import { NoopUploadScanner, type UploadScanner } from './services/upload-scanner'
import { resolveCaptchaVerifier, type CaptchaVerifier } from './services/captcha-verifier'
import { DefaultPrefillResolver, type PrefillResolver } from './services/prefill-resolver'
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

  // T7 — async-batched access audit. `FORMS_ACCESS_AUDIT_BATCH_MS=0` (default)
  // keeps the synchronous insert-per-read posture on the request's own EM
  // (deterministic for tests). A positive value buffers events and flushes them
  // as a bulk insert on a fresh forked EM, off the read hot path.
  const accessAuditBatchMs = resolveAccessAuditBatchMs(process.env)
  const accessAuditLogger: AccessAuditLogger =
    accessAuditBatchMs > 0
      ? new BatchingAccessAuditLogger({
          batchMs: accessAuditBatchMs,
          // Fork a fresh EM at flush time — the request EM is long gone.
          emFactory: async (): Promise<EntityManager> => {
            const orm = await getOrm()
            return orm.em.fork() as unknown as EntityManager
          },
        })
      : new FormsAccessAuditLogger()

  container.register({
    fieldTypeRegistry: asValue(defaultFieldTypeRegistry),
    formVersionCompiler: asValue(formVersionCompiler),
    formVersionDiffer: asValue(formVersionDiffer),
    formsRolePolicyService: asValue(rolePolicyService),
    formsAccessAuditLogger: asValue(accessAuditLogger),
    formsEncryptionService: asFunction(({ em }: { em: EntityManager }): EncryptionService => {
      // resolveKmsAdapter picks the production env master-key adapter (or an
      // operator-injected cloud-KMS adapter) and refuses the DEV-ONLY fallback
      // when NODE_ENV=production (spec W1 / risk R-1). An operator may also
      // inject a custom adapter via setKmsAdapterFactory(...).
      return new FormsEncryptionService({
        emFactory: () => em,
        kmsAdapter: resolveKmsAdapter(process.env),
      })
    }).proxy().singleton(),
    formsSubmissionService: asFunction(({ em, formsEncryptionService }: { em: EntityManager; formsEncryptionService: EncryptionService }): SubmissionService => {
      return new SubmissionService({
        emFactory: () => em,
        formVersionCompiler,
        encryptionService: formsEncryptionService,
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
    }).proxy().singleton(),
    formsDistributionService: asFunction(({ em, formsSubmissionService }: { em: EntityManager; formsSubmissionService: SubmissionService }): DistributionService => {
      return new DistributionService({
        emFactory: () => em,
        submissionService: formsSubmissionService,
        emitEvent: async (eventId, payload) => {
          const schema = formsEventPayloadSchemas[eventId as keyof typeof formsEventPayloadSchemas]
          const validated = schema ? schema.parse(payload) : payload
          await emitFormsEvent(eventId, validated as never)
        },
      })
    }).proxy().singleton(),
    formsAnonymizeService: asFunction(({ em, formsEncryptionService }: { em: EntityManager; formsEncryptionService: EncryptionService }): AnonymizeService => {
      return new AnonymizeService({
        em,
        compiler: formVersionCompiler,
        encryption: formsEncryptionService,
      })
    }).proxy().singleton(),
    // Phase 3 Track B — aggregate, PII-safe form analytics. Decrypts revision
    // payloads only to tally enumerable answers; never returns decrypted
    // values. Lazy-resolves `em` per request so EM request scoping is honoured.
    formsAnalyticsService: asFunction(({ em, formsEncryptionService }: { em: EntityManager; formsEncryptionService: EncryptionService }): AnalyticsService => {
      return new AnalyticsService({
        emFactory: () => em,
        compiler: formVersionCompiler,
        encryption: formsEncryptionService,
      })
    }).proxy().singleton(),
    // Phase 3 Track D — projects signed `signature` answers into the
    // `forms_consent_record` per-subject consent aggregate. Loads the
    // submission via the submission service (admin/full read, no role slice)
    // so signature answers are present, then upserts + supersedes. PII-free.
    // Lazy-resolves `em` per request so EM request scoping is honoured.
    formsConsentRecordService: asFunction(
      ({ em, formsSubmissionService }: { em: EntityManager; formsSubmissionService: SubmissionService }): ConsentRecordService => {
        return new ConsentRecordService({
          emFactory: () => em,
          compiler: formVersionCompiler,
          loadSubmission: async ({ submissionId, organizationId, tenantId }) => {
            const view = await formsSubmissionService.getCurrent({
              submissionId,
              organizationId,
              tenantId,
            })
            return {
              submission: view.submission,
              formVersion: view.formVersion,
              decodedData: view.decodedData,
            }
          },
        })
      },
    ).proxy().singleton(),
    // W5 (DP-5) — builds the structured GDPR data-subject export document.
    // Lazy-resolves `em` per request so EM request scoping is honoured.
    formsExportService: asFunction(({ em, formsEncryptionService }: { em: EntityManager; formsEncryptionService: EncryptionService }): ExportService => {
      return new ExportService({
        emFactory: () => em,
        compiler: formVersionCompiler,
        encryption: formsEncryptionService,
      })
    }).proxy().singleton(),
    // W4 — no-op virus/malware scanner. Operators inject a real scanner by
    // overriding `formsUploadScanner` with their own `UploadScanner`.
    formsUploadScanner: asValue<UploadScanner>(new NoopUploadScanner()),
    // W8 / FD-1 — default patient prefill resolver. Maps `name`/`email` from
    // the customer auth context; anonymous principals resolve to `{}`. Stateless
    // and pure, so `asValue` is correct. Operators inject a richer resolver
    // (e.g. dental-os providing `dob`) by overriding `formsPrefillResolver`.
    formsPrefillResolver: asValue<PrefillResolver>(new DefaultPrefillResolver()),
    // T5 — pluggable CAPTCHA verifier for the public start route. Selects a
    // provider verifier (Cloudflare Turnstile / Google reCAPTCHA) when
    // `FORMS_CAPTCHA_PROVIDER` + `FORMS_CAPTCHA_SECRET` are set; otherwise a
    // no-op verifier (token presence is still enforced by the route for
    // backward-compat). Stateless, so `asValue` is correct. Operators inject a
    // custom verifier by overriding `formsCaptchaVerifier`.
    formsCaptchaVerifier: asValue<CaptchaVerifier>(resolveCaptchaVerifier(process.env)),
    // W4 — encrypts + persists participant uploads as `forms_form_attachment`
    // rows. Lazy-resolves `em` per request so EM request scoping is honoured.
    formsAttachmentService: asFunction(
      ({
        em,
        formsEncryptionService,
        formsUploadScanner,
      }: {
        em: EntityManager
        formsEncryptionService: EncryptionService
        formsUploadScanner: UploadScanner
      }): AttachmentService => {
        return new AttachmentService({
          emFactory: () => em,
          encryptionService: formsEncryptionService,
          scanner: formsUploadScanner,
        })
      },
    ).proxy().singleton(),
    // W3 — renders + stores the immutable signed PDF snapshot as an encrypted
    // `forms_form_attachment` (`kind = 'snapshot'`). Generated once (on-submit
    // subscriber or lazily on first download) and idempotent thereafter.
    formsPdfSnapshotService: asFunction(
      ({
        em,
        formsEncryptionService,
      }: {
        em: EntityManager
        formsEncryptionService: EncryptionService
      }): PdfSnapshotService => {
        return new PdfSnapshotService({
          emFactory: () => em,
          encryptionService: formsEncryptionService,
          emitEvent: async (eventId, payload) => {
            const schema = formsEventPayloadSchemas[eventId as keyof typeof formsEventPayloadSchemas]
            const validated = schema ? schema.parse(payload) : payload
            await emitFormsEvent(eventId, validated as never)
          },
        })
      },
    ).proxy().singleton(),
  })
}
