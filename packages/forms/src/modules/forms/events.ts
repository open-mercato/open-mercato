import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Forms module event catalog.
 *
 * Every event ID listed here is a CONTRACT SURFACE (root AGENTS.md
 * § Backward Compatibility Contract § 5 — Event IDs are FROZEN). Adding new
 * IDs is additive; renaming or removing an existing ID is a breaking change
 * that requires the deprecation protocol.
 *
 * Phase 1a declares the catalog only. Emission lands in:
 *  - `forms.form.created` / `forms.form.archived`        — phase 1b
 *  - `forms.form_version.published`                       — phase 1b
 *  - `forms.submission.started` / `revision_appended`     — phase 1c
 *  - `forms.submission.submitted` / `reopened`            — phase 1c / 2a
 *  - `forms.submission.actor_assigned`                    — phase 2a
 *  - `forms.submission.anonymized`                        — phase 2b
 *  - `forms.attachment.uploaded`                          — phase 2c
 */
const events = [
  { id: 'forms.form.created', label: 'Form Created', entity: 'form', category: 'crud' as const },
  { id: 'forms.form.archived', label: 'Form Archived', entity: 'form', category: 'lifecycle' as const },
  { id: 'forms.form_version.published', label: 'Form Version Published', entity: 'form_version', category: 'lifecycle' as const },
  { id: 'forms.submission.started', label: 'Submission Started', entity: 'submission', category: 'lifecycle' as const },
  { id: 'forms.submission.revision_appended', label: 'Submission Revision Appended', entity: 'submission', category: 'lifecycle' as const, portalBroadcast: true },
  { id: 'forms.submission.submitted', label: 'Submission Submitted', entity: 'submission', category: 'lifecycle' as const, clientBroadcast: true, portalBroadcast: true },
  { id: 'forms.submission.reopened', label: 'Submission Reopened', entity: 'submission', category: 'lifecycle' as const },
  { id: 'forms.submission.actor_assigned', label: 'Submission Actor Assigned', entity: 'submission', category: 'lifecycle' as const },
  { id: 'forms.submission.anonymized', label: 'Submission Anonymized', entity: 'submission', category: 'lifecycle' as const },
  { id: 'forms.attachment.uploaded', label: 'Attachment Uploaded', entity: 'attachment', category: 'crud' as const },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'forms',
  events,
})

export const emitFormsEvent = eventsConfig.emit

export type FormsEventId = typeof events[number]['id']

export default eventsConfig
