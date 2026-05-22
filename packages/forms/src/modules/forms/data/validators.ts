import { z } from 'zod'
import { normalizeEmbedOrigin } from '../lib/embed-frame-policy'

/**
 * Forms module shared Zod primitives + Phase 1b/1c command/API schemas.
 *
 * Phase 1a shipped only the building-block primitives. Phase 1b extends with
 * the form definition + version lifecycle command/API schemas. Phase 1c adds
 * the runtime submission schemas.
 */

/**
 * Form key — stable per-organization slug. 3-64 chars; starts with a lower
 * case letter; contains only `[a-z0-9_-]`. Treated as a contract surface for
 * external integrations; uniqueness is enforced at the DB level by
 * UNIQUE (organization_id, key).
 */
export const formKeySchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/, {
    message: 'Form key must start with a lowercase letter and only contain lowercase letters, digits, hyphens, and underscores.',
  })

/**
 * Locale tag — minimal BCP-47 shape. `en`, `en-US`, `pl`, `pl-PL`, etc.
 * Studio (phase 1b) may expand this once the locale picker ships.
 */
export const localeSchema = z
  .string()
  .min(2)
  .max(10)
  .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/, {
    message: 'Locale must be a BCP-47 tag like "en" or "en-US".',
  })

/**
 * Role identifier — used in `x-om-roles`, `x-om-editable-by`, `x-om-visible-to`,
 * and the form-version `roles` column. Lower-case, slug-shaped, snake-kebab
 * mix tolerated. Common values: `patient`, `clinician`, `admin`, `guardian`.
 */
export const roleIdentifierSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/, {
    message: 'Role identifier must start with a lowercase letter and only contain lowercase letters, digits, hyphens, and underscores.',
  })

export type FormKey = z.infer<typeof formKeySchema>
export type Locale = z.infer<typeof localeSchema>
export type RoleIdentifier = z.infer<typeof roleIdentifierSchema>

/**
 * Submission subject identifier. Polymorphic: subject_type is a free-form
 * string tag (`patient`, `customer`, `case`, etc.); subject_id MUST be a
 * UUID. Validation of the (subject_type, subject_id) pair against actual
 * domain entities is the responsibility of the calling module.
 */
export const submissionSubjectSchema = z.object({
  subject_type: z.string().min(1).max(64),
  subject_id: z.string().uuid(),
})

/**
 * Body for `POST /api/form-submissions` — runtime start.
 */
export const submissionStartInputSchema = z.object({
  form_key: formKeySchema,
  subject_type: z.string().min(1).max(64),
  subject_id: z.string().uuid(),
  locale: localeSchema.optional(),
})

export type SubmissionStartInput = z.infer<typeof submissionStartInputSchema>

/**
 * Body for `PATCH /api/form-submissions/:id` — autosave.
 *
 * `patch` is left as `passthrough` because the field-set is dynamic per form
 * version; the SubmissionService enforces `additionalProperties: false`
 * via the AJV validator from the compiler before persisting.
 */
export const submissionSaveInputSchema = z.object({
  base_revision_id: z.string().uuid(),
  patch: z.record(z.string(), z.unknown()),
  change_summary: z.string().max(500).optional(),
})

export type SubmissionSaveInput = z.infer<typeof submissionSaveInputSchema>

/**
 * Body for `POST /api/form-submissions/:id/submit` — final submit.
 */
export const submissionSubmitInputSchema = z.object({
  base_revision_id: z.string().uuid(),
  submit_metadata: z.record(z.string(), z.unknown()).optional(),
})

export type SubmissionSubmitInput = z.infer<typeof submissionSubmitInputSchema>

/**
 * Body for `POST /api/forms/submissions/:submissionId/actors` — admin assigns
 * a (user, role) pair to a submission. The role MUST be one of the form
 * version's declared roles; the SubmissionService enforces this.
 */
export const assignActorInputSchema = z.object({
  user_id: z.string().uuid(),
  role: roleIdentifierSchema,
})

export type AssignActorInput = z.infer<typeof assignActorInputSchema>

export const revokeActorInputSchema = z.object({
  actor_id: z.string().uuid(),
})

export type RevokeActorInput = z.infer<typeof revokeActorInputSchema>

// ============================================================================
// Phase 1b — Definition Authoring (CRUD + Studio) command + API schemas
// ============================================================================

const scopedFields = {
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
} as const

const optionalDescription = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()

const optionalChangelog = z
  .string()
  .trim()
  .max(4000)
  .optional()
  .nullable()

export const formStatusSchema = z.enum(['draft', 'active', 'archived'])
export const formVersionStatusSchema = z.enum(['draft', 'published', 'archived'])

const jsonObjectSchema = z.record(z.string(), z.unknown())

const supportedLocalesSchema = z.array(localeSchema).min(1).max(20)

/**
 * Per-form retention window in days (W5 / DP-6). `null` keeps submissions
 * forever; a positive integer drives the retention-purge worker. Capped at
 * ~100 years so a typo cannot disable purge by accident while still allowing
 * decade-long legal-retention windows.
 */
const retentionDaysSchema = z.number().int().min(1).max(36500).optional().nullable()

/** Query schema for `GET /api/forms`. */
export const formListQuerySchema = z.object({
  status: z
    .union([formStatusSchema, z.array(formStatusSchema).max(3)])
    .optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})

export type FormListQueryInput = z.infer<typeof formListQuerySchema>

/** Command input for `forms.form.create`. */
export const formCreateCommandSchema = z.object({
  ...scopedFields,
  key: formKeySchema,
  name: z.string().trim().min(1).max(200),
  description: optionalDescription,
  defaultLocale: localeSchema,
  supportedLocales: supportedLocalesSchema,
  retentionDays: retentionDaysSchema,
})

export type FormCreateCommandInput = z.infer<typeof formCreateCommandSchema>

/**
 * Command input for `forms.form.rename`. Despite the name, this command is the
 * single form-metadata update path: name, description, and (W7) the locale set.
 * `defaultLocale` must be one of `supportedLocales` — enforced at execute time.
 */
export const formRenameCommandSchema = z.object({
  ...scopedFields,
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  description: optionalDescription,
  defaultLocale: localeSchema.optional(),
  supportedLocales: supportedLocalesSchema.optional(),
  retentionDays: retentionDaysSchema,
})

export type FormRenameCommandInput = z.infer<typeof formRenameCommandSchema>

/** Command input for `forms.form.archive`. */
export const formArchiveCommandSchema = z.object({
  ...scopedFields,
  id: z.string().uuid(),
})

export type FormArchiveCommandInput = z.infer<typeof formArchiveCommandSchema>

/** Command input for `forms.form.restore`. */
export const formRestoreCommandSchema = z.object({
  ...scopedFields,
  id: z.string().uuid(),
})

export type FormRestoreCommandInput = z.infer<typeof formRestoreCommandSchema>

/** Command input for `forms.form_version.fork_draft`. */
export const formVersionForkDraftCommandSchema = z.object({
  ...scopedFields,
  formId: z.string().uuid(),
  fromVersionId: z.string().uuid().optional().nullable(),
})

export type FormVersionForkDraftCommandInput = z.infer<typeof formVersionForkDraftCommandSchema>

/** Command input for `forms.form_version.update_draft`. */
export const formVersionUpdateDraftCommandSchema = z.object({
  ...scopedFields,
  formId: z.string().uuid(),
  versionId: z.string().uuid(),
  schema: jsonObjectSchema.optional(),
  uiSchema: jsonObjectSchema.optional(),
  roles: z.array(roleIdentifierSchema).max(50).optional(),
  changelog: optionalChangelog,
})

export type FormVersionUpdateDraftCommandInput = z.infer<typeof formVersionUpdateDraftCommandSchema>

/** Command input for `forms.form_version.publish`. */
export const formVersionPublishCommandSchema = z.object({
  ...scopedFields,
  formId: z.string().uuid(),
  versionId: z.string().uuid(),
  changelog: z.string().trim().max(4000).optional().nullable(),
})

export type FormVersionPublishCommandInput = z.infer<typeof formVersionPublishCommandSchema>

/** Command input for `forms.form_version.archive`. */
export const formVersionArchiveCommandSchema = z.object({
  ...scopedFields,
  formId: z.string().uuid(),
  versionId: z.string().uuid(),
})

export type FormVersionArchiveCommandInput = z.infer<typeof formVersionArchiveCommandSchema>

/** POST /api/forms request body (route layer fills tenant/organization scope). */
export const formCreateRequestSchema = formCreateCommandSchema.omit({
  tenantId: true,
  organizationId: true,
})

/** PATCH /api/forms/:id request body. */
export const formPatchRequestSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: optionalDescription,
  defaultLocale: localeSchema.optional(),
  supportedLocales: supportedLocalesSchema.optional(),
  retentionDays: retentionDaysSchema,
})

/** POST /api/forms/:id/versions/fork request body. */
export const formVersionForkRequestSchema = z.object({
  fromVersionId: z.string().uuid().optional().nullable(),
})

/** PATCH /api/forms/:id/versions/:versionId request body. */
export const formVersionPatchRequestSchema = z.object({
  schema: jsonObjectSchema.optional(),
  uiSchema: jsonObjectSchema.optional(),
  roles: z.array(roleIdentifierSchema).max(50).optional(),
  changelog: optionalChangelog,
})

/** POST /api/forms/:id/versions/:versionId/publish request body. */
export const formVersionPublishRequestSchema = z.object({
  changelog: z.string().trim().max(4000).optional().nullable(),
})

/** GET /api/forms/:id/versions/:versionId/diff query. */
export const formVersionDiffQuerySchema = z.object({
  against: z.string().uuid(),
})

export type FormCreateRequestInput = z.infer<typeof formCreateRequestSchema>
export type FormPatchRequestInput = z.infer<typeof formPatchRequestSchema>
export type FormVersionForkRequestInput = z.infer<typeof formVersionForkRequestSchema>
export type FormVersionPatchRequestInput = z.infer<typeof formVersionPatchRequestSchema>
export type FormVersionPublishRequestInput = z.infer<typeof formVersionPublishRequestSchema>
export type FormVersionDiffQueryInput = z.infer<typeof formVersionDiffQuerySchema>

export type FormStatus = z.infer<typeof formStatusSchema>
export type FormVersionStatus = z.infer<typeof formVersionStatusSchema>

// ============================================================================
// Phase 2d — Distribution & Anonymous Submission command/API schemas
// ============================================================================

export const distributionModeSchema = z.enum(['open', 'personal'])
export const distributionStatusSchema = z.enum(['active', 'paused', 'closed'])

export type FormDistributionMode = z.infer<typeof distributionModeSchema>
export type FormDistributionStatus = z.infer<typeof distributionStatusSchema>

const isoDateTimeSchema = z.string().datetime({ offset: true })

const optionalRedirectUrl = z.string().url().max(2000).optional().nullable()

/**
 * A single embed allowlist origin. Validated to the strict origin shape
 * (scheme + host + optional port, https-only except localhost) via the shared
 * `normalizeEmbedOrigin` policy helper so the Zod layer and the runtime CSP
 * builder agree byte-for-byte (R-RS-1).
 */
const embedAllowedDomainSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine((value) => normalizeEmbedOrigin(value) !== null, {
    message:
      'Allowed domain must be an https origin like "https://www.acme.com" (http is permitted only for localhost). No path, query, or fragment.',
  })

/**
 * `settings.embed` — opt-in external-website framing config (spec D6). Rides on
 * the existing `forms_distribution.settings` JSON column; no migration. Enabling
 * embedding REQUIRES a non-empty allowlist — an enabled bag with zero allowed
 * domains is rejected at save time (R-RS-1). `allowedDomains` is NEVER echoed to
 * any public context payload.
 */
export const embedSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    allowedDomains: z.array(embedAllowedDomainSchema).max(50).default([]),
    theme: z.enum(['light', 'dark', 'auto']).optional(),
    autoResize: z.boolean().default(true),
  })
  .strict()
  .refine((value) => !value.enabled || value.allowedDomains.length > 0, {
    message: 'Embedding cannot be enabled without at least one allowed domain.',
    path: ['allowedDomains'],
  })

export type EmbedSettingsInput = z.infer<typeof embedSettingsSchema>

/**
 * Distribution `settings` JSON bag. Additive, backward-compatible: known keys
 * (`embed`) are validated; every other key (`captcha`, `completion`, …) passes
 * through untouched so existing settings shapes keep working.
 */
export const distributionSettingsSchema = z
  .object({
    embed: embedSettingsSchema.optional(),
  })
  .passthrough()

export type DistributionSettingsInput = z.infer<typeof distributionSettingsSchema>

/** Command input for `forms.distribution.create`. */
export const distributionCreateCommandSchema = z.object({
  ...scopedFields,
  formId: z.string().uuid(),
  mode: distributionModeSchema,
  pinnedVersionId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(200).optional().nullable(),
  defaultLocale: localeSchema,
  requireCustomerAuth: z.boolean().optional(),
  allowMultipleSubmissions: z.boolean().optional(),
  maxResponses: z.number().int().positive().optional().nullable(),
  opensAt: isoDateTimeSchema.optional().nullable(),
  closesAt: isoDateTimeSchema.optional().nullable(),
  redirectUrl: optionalRedirectUrl,
  settings: distributionSettingsSchema.optional().nullable(),
})

export type FormDistributionCreateCommandInput = z.infer<typeof distributionCreateCommandSchema>

/** Command input for `forms.distribution.update`. */
export const distributionUpdateCommandSchema = z.object({
  ...scopedFields,
  distributionId: z.string().uuid(),
  status: distributionStatusSchema.optional(),
  title: z.string().trim().min(1).max(200).optional().nullable(),
  maxResponses: z.number().int().positive().optional().nullable(),
  opensAt: isoDateTimeSchema.optional().nullable(),
  closesAt: isoDateTimeSchema.optional().nullable(),
  redirectUrl: optionalRedirectUrl,
  allowMultipleSubmissions: z.boolean().optional(),
  requireCustomerAuth: z.boolean().optional(),
  settings: distributionSettingsSchema.optional().nullable(),
})

export type FormDistributionUpdateCommandInput = z.infer<typeof distributionUpdateCommandSchema>

/** Command input for `forms.distribution.close`. */
export const distributionCloseCommandSchema = z.object({
  ...scopedFields,
  distributionId: z.string().uuid(),
})

export type FormDistributionCloseCommandInput = z.infer<typeof distributionCloseCommandSchema>

const invitationRecipientSchema = z.object({
  email: z.string().email().max(320).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  ref: z.string().trim().min(1).max(200).optional(),
  role: roleIdentifierSchema.optional(),
  locale: localeSchema.optional(),
  expiresAt: isoDateTimeSchema.optional(),
})

export type FormInvitationRecipientInput = z.infer<typeof invitationRecipientSchema>

/** Command input for `forms.invitation.create` — bulk recipient creation. */
export const invitationCreateCommandSchema = z.object({
  ...scopedFields,
  distributionId: z.string().uuid(),
  recipients: z.array(invitationRecipientSchema).min(1).max(1000),
})

export type FormInvitationCreateCommandInput = z.infer<typeof invitationCreateCommandSchema>

/** Command input for `forms.invitation.send`. */
export const invitationSendCommandSchema = z.object({
  ...scopedFields,
  invitationId: z.string().uuid(),
})

export type FormInvitationSendCommandInput = z.infer<typeof invitationSendCommandSchema>

/** Command input for `forms.invitation.revoke`. */
export const invitationRevokeCommandSchema = z.object({
  ...scopedFields,
  invitationId: z.string().uuid(),
})

export type FormInvitationRevokeCommandInput = z.infer<typeof invitationRevokeCommandSchema>

/**
 * Body for the public anonymous start endpoint. Exactly one of `slug`
 * (open-mode public link) or `token` (personal-mode invitation) MUST be
 * present; the refine below enforces the disjunction.
 */
export const publicStartInputSchema = z
  .object({
    slug: z.string().min(1).max(200).optional(),
    token: z.string().min(1).max(512).optional(),
    locale: localeSchema.optional(),
    captchaToken: z.string().min(1).max(4000).optional(),
  })
  .refine((value) => Boolean(value.slug) !== Boolean(value.token), {
    message: 'Exactly one of "slug" or "token" must be provided.',
  })

export type PublicStartInput = z.infer<typeof publicStartInputSchema>
