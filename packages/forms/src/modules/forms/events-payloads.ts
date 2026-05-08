import { z } from 'zod'

/**
 * Typed payload schemas for every event declared in `events.ts`.
 *
 * `createModuleEvents()` only enforces the event ID at compile time — payload
 * shape is left to the emitter. To keep the cross-module contract honest,
 * downstream phases (1b authoring, 1c submission core, 2a inbox, 2b
 * compliance) MUST validate their emit payload against the schema for the
 * event they emit:
 *
 * ```ts
 * import { formsEventPayloadSchemas } from '@open-mercato/forms'
 * await emitFormsEvent('forms.submission.submitted', formsEventPayloadSchemas['forms.submission.submitted'].parse(payload))
 * ```
 *
 * The IDs here mirror the catalog one-to-one. Adding/renaming/removing a
 * payload field is a BC consideration just like the IDs themselves; new
 * fields should be added as optional first.
 */

const submissionRevisionAppendedSchema = z.object({
  submissionId: z.string().uuid(),
  revisionId: z.string().uuid(),
  savedBy: z.string().uuid(),
  savedByRole: z.string().min(1),
  changedFieldKeys: z.array(z.string()),
})

const submissionActorAssignedSchema = z.object({
  submissionId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.string().min(1),
})

export const formsEventPayloadSchemas = {
  'forms.form.created': z.object({
    formId: z.string().uuid(),
    organizationId: z.string().uuid(),
  }),
  'forms.form.archived': z.object({
    formId: z.string().uuid(),
  }),
  'forms.form_version.published': z.object({
    formId: z.string().uuid(),
    versionId: z.string().uuid(),
    versionNumber: z.number().int().nonnegative(),
    publishedBy: z.string().uuid(),
  }),
  'forms.submission.started': z.object({
    submissionId: z.string().uuid(),
    formVersionId: z.string().uuid(),
  }),
  'forms.submission.revision_appended': submissionRevisionAppendedSchema,
  'forms.submission.submitted': z.object({
    submissionId: z.string().uuid(),
  }),
  'forms.submission.reopened': z.object({
    submissionId: z.string().uuid(),
  }),
  'forms.submission.actor_assigned': submissionActorAssignedSchema,
  'forms.submission.anonymized': z.object({
    submissionId: z.string().uuid(),
  }),
  'forms.attachment.uploaded': z.object({
    attachmentId: z.string().uuid(),
    submissionId: z.string().uuid(),
  }),
} as const

export type FormsEventPayload = {
  [K in keyof typeof formsEventPayloadSchemas]: z.infer<typeof formsEventPayloadSchemas[K]>
}
