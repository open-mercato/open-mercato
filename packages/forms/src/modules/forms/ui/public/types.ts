/**
 * Public renderer (FormRunner) shared types.
 *
 * These types describe the runtime API responses consumed by `useFormRunner`
 * and the data passed into individual field renderers. They mirror the JSON
 * payload returned by phase 1c routes (`GET /api/forms/by-key/:key/active`,
 * `POST /api/forms/form-submissions`, `GET/PATCH /api/forms/form-submissions/:id`,
 * `POST /api/forms/form-submissions/:id/submit`).
 */

export type RunnerLocaleMap = Record<string, string>

export type RunnerOption = {
  value: string
  label: RunnerLocaleMap
}

export type RunnerFieldNode = {
  type: string | string[]
  'x-om-type'?: string
  'x-om-label'?: RunnerLocaleMap
  'x-om-help'?: RunnerLocaleMap
  'x-om-options'?: RunnerOption[]
  'x-om-min'?: number
  'x-om-max'?: number
  'x-om-sensitive'?: boolean
  'x-om-editable-by'?: string[]
  'x-om-visible-to'?: string[]
  'x-om-widget'?: string
  enum?: unknown[]
  minLength?: number
  maxLength?: number
  pattern?: string
  [key: string]: unknown
}

export type RunnerSection = {
  key: string
  title: RunnerLocaleMap
  fieldKeys: string[]
}

export type RunnerSchema = {
  type?: string
  'x-om-roles'?: string[]
  'x-om-default-actor-role'?: string
  'x-om-sections'?: RunnerSection[]
  properties?: Record<string, RunnerFieldNode>
  required?: string[]
  [key: string]: unknown
}

export type RunnerFieldDescriptor = {
  key: string
  type: string
  sectionKey: string | null
  sensitive: boolean
  editableBy: string[]
  visibleTo: string[]
  required: boolean
}

export type RunnerActiveFormResponse = {
  form: {
    id: string
    key: string
    name: string
    defaultLocale: string
    supportedLocales: string[]
  }
  formVersion: {
    id: string
    versionNumber: number
    schemaHash: string
    registryVersion: string
    roles: string[]
  }
  schema: RunnerSchema
  uiSchema: Record<string, unknown>
  fieldIndex: Record<string, RunnerFieldDescriptor>
  callerRoles: string[]
}

export type RunnerSubmissionStatus = 'draft' | 'submitted' | 'reopened' | 'archived'

export type RunnerSubmission = {
  id: string
  organizationId: string
  tenantId: string
  formVersionId: string
  subjectType: string
  subjectId: string
  status: RunnerSubmissionStatus
  currentRevisionId: string | null
  startedBy: string
  submittedBy: string | null
  firstSavedAt: string | null
  submittedAt: string | null
  submitMetadata: Record<string, unknown> | null
  pdfSnapshotAttachmentId: string | null
  anonymizedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type RunnerRevision = {
  id: string
  submissionId: string
  revisionNumber: number
  encryptionKeyVersion: number | null
  savedAt: string | null
  savedBy: string
  savedByRole: string | null
  changeSource: string
  changedFieldKeys: string[]
  changeSummary: string | null
  anonymizedAt: string | null
}

export type RunnerActor = {
  id: string
  submissionId: string
  userId: string
  role: string
  assignedAt: string | null
  revokedAt: string | null
}

export type RunnerSubmissionView = {
  submission: RunnerSubmission
  revision: RunnerRevision
  decoded_data: Record<string, unknown>
  actors: RunnerActor[]
}

export type RunnerSaveResult = {
  revision: RunnerRevision
  coalesced: boolean
}

export type RunnerSaveState =
  | { status: 'idle' }
  | { status: 'dirty' }
  | { status: 'saving' }
  | { status: 'saved'; savedAt: string }
  | { status: 'conflict'; message: string }
  | { status: 'error'; message: string }

export type RunnerErrorCode =
  | 'NETWORK'
  | 'NOT_FOUND'
  | 'NO_PUBLISHED_VERSION'
  | 'UNAUTHORIZED'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'UNKNOWN'

export type RunnerLoadError = {
  code: RunnerErrorCode
  message: string
}

export type RunnerFieldRendererProps = {
  field: RunnerFieldDescriptor
  fieldNode: RunnerFieldNode
  value: unknown
  onChange: (next: unknown) => void
  onBlur?: () => void
  locale: string
  defaultLocale: string
  disabled?: boolean
  error?: string | null
  inputId?: string
}

export function resolveLocaleString(
  map: RunnerLocaleMap | undefined,
  locale: string,
  defaultLocale: string,
  fallback: string,
): string {
  if (!map) return fallback
  if (typeof map[locale] === 'string' && map[locale].length > 0) return map[locale]
  if (typeof map[defaultLocale] === 'string' && map[defaultLocale].length > 0) return map[defaultLocale]
  for (const key of Object.keys(map)) {
    const value = map[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return fallback
}

export function resolveSectionTitle(
  section: RunnerSection,
  locale: string,
  defaultLocale: string,
): string {
  return resolveLocaleString(section.title, locale, defaultLocale, section.key)
}
