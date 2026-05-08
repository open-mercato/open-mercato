import { z } from 'zod'

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
})

export type FormCreateCommandInput = z.infer<typeof formCreateCommandSchema>

/** Command input for `forms.form.rename`. */
export const formRenameCommandSchema = z.object({
  ...scopedFields,
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  description: optionalDescription,
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
