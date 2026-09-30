"use client"

import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type {
  RunnerActiveFormResponse,
  RunnerActor,
  RunnerErrorCode,
  RunnerFieldDescriptor,
  RunnerFileAttachmentRef,
  RunnerLoadError,
  RunnerRevision,
  RunnerSaveResult,
  RunnerSchema,
  RunnerSubmission,
  RunnerSubmissionView,
} from '../types'

/**
 * Transport abstraction shared by `useFormRunner`. The hook performs six
 * network operations; each runtime client implements them against a concrete
 * backend (authenticated portal endpoints or the public token endpoints) while
 * the hook keeps all stage / conflict / autosave logic transport-agnostic.
 *
 * `save` / `submit` expose the raw HTTP status so the hook can branch on a 409
 * conflict exactly as it did when it called `apiCall` inline.
 */
export type RuntimeSaveBody = {
  base_revision_id: string
  patch: Record<string, unknown>
  change_summary?: string | null
}

export type RuntimeSubmitBody = {
  base_revision_id: string
  submit_metadata?: Record<string, unknown> | null
}

export type RuntimeStartedState = {
  submission: RunnerSubmission
  revision: RunnerRevision
  decodedData: Record<string, unknown>
  actors: RunnerActor[]
}

export interface RuntimeClient {
  loadActiveSchema(): Promise<RunnerActiveFormResponse>
  loadResumeCandidates(): Promise<RunnerSubmission[]>
  loadSubmissionDetail(submissionId: string): Promise<RuntimeStartedState>
  startSubmission(): Promise<RuntimeStartedState>
  save(
    submissionId: string,
    body: RuntimeSaveBody,
  ): Promise<{ status: number; result: RunnerSaveResult | null }>
  submit(
    submissionId: string,
    body: RuntimeSubmitBody,
  ): Promise<{ status: number; result: { submission: RunnerSubmission } | null }>
  /**
   * Uploads a file for a `file`-typed field. The client picks the correct
   * endpoint + auth model (authenticated portal vs anonymous token). Throws a
   * `RunnerLoadError` on failure.
   */
  uploadAttachment(
    submissionId: string,
    fieldKey: string,
    file: File,
  ): Promise<RunnerFileAttachmentRef>
  /** Returns a URL the participant can open to download their own upload. */
  attachmentDownloadUrl(submissionId: string, attachmentId: string): string
  /**
   * Triggers a browser download of the submission's signed-PDF snapshot. The
   * client picks the correct endpoint + auth model (cookie-auth portal vs
   * anonymous bearer token). Resolves once the download has been initiated;
   * throws a `RunnerLoadError` when the snapshot cannot be fetched.
   */
  downloadPdf(submissionId: string): Promise<void>
}

/**
 * Fetches the snapshot bytes (optionally with a bearer token), then triggers a
 * client-side blob download. Shared by both runtime clients. No-ops outside the
 * browser (SSR safety).
 */
async function triggerPdfDownload(url: string, headers?: Record<string, string>): Promise<void> {
  if (typeof window === 'undefined') return
  const response = await fetch(url, { headers, credentials: 'include' })
  if (!response.ok) {
    if (response.status === 401) throw makeError('UNAUTHORIZED', 'Your session for this form has expired.')
    if (response.status === 404) throw makeError('NOT_FOUND', 'The PDF copy is not ready yet.')
    throw makeError('UNKNOWN', `Could not download the PDF (status ${response.status}).`)
  }
  const blob = await response.blob()
  const objectUrl = window.URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = objectUrl
  anchor.download = readFilename(response) ?? 'submission.pdf'
  window.document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(objectUrl)
}

function readFilename(response: Response): string | null {
  const disposition = response.headers.get('content-disposition')
  if (!disposition) return null
  const match = /filename="?([^"]+)"?/i.exec(disposition)
  return match ? match[1] : null
}

function makeError(code: RunnerErrorCode, message: string): RunnerLoadError {
  return { code, message }
}

function viewToStarted(view: RunnerSubmissionView): RuntimeStartedState {
  return {
    submission: view.submission,
    revision: view.revision,
    decodedData: view.decoded_data ?? {},
    actors: view.actors ?? [],
  }
}

// ============================================================================
// Authenticated client (default) — verbatim port of the inline apiCall logic
// that `useFormRunner` shipped with. Behaviour MUST stay byte-for-byte
// identical to the authenticated portal flow.
// ============================================================================

export type CreateAuthRuntimeClientArgs = {
  formKey: string
  subjectType: string
  subjectId: string
}

export function createAuthRuntimeClient(args: CreateAuthRuntimeClientArgs): RuntimeClient {
  const { formKey, subjectType, subjectId } = args

  return {
    async loadActiveSchema() {
      const response = await apiCall<RunnerActiveFormResponse>(
        `/api/forms/by-key/${encodeURIComponent(formKey)}/active`,
      )
      if (response.status === 401) {
        throw makeError('UNAUTHORIZED', 'You need to be signed in to fill this form.')
      }
      if (response.status === 404) {
        throw makeError('NOT_FOUND', 'We couldn\'t find that form.')
      }
      if (response.status === 422) {
        throw makeError('NO_PUBLISHED_VERSION', 'This form has no published version yet.')
      }
      if (!response.ok || !response.result) {
        throw makeError('UNKNOWN', `Failed to load form (status ${response.status}).`)
      }
      return response.result
    },

    async loadResumeCandidates() {
      const response = await apiCall<{ items: RunnerSubmission[] }>(
        `/api/forms/form-submissions/by-subject/${encodeURIComponent(subjectType)}/${encodeURIComponent(subjectId)}`,
      )
      if (!response.ok || !response.result) return []
      return response.result.items.filter(
        (entry) => entry.status === 'draft' || entry.status === 'reopened',
      )
    },

    async loadSubmissionDetail(submissionId: string) {
      const response = await apiCall<RunnerSubmissionView>(
        `/api/forms/form-submissions/${encodeURIComponent(submissionId)}`,
      )
      if (response.status === 404) {
        throw makeError('NOT_FOUND', 'Submission not found.')
      }
      if (!response.ok || !response.result) {
        throw makeError('UNKNOWN', `Failed to load submission (status ${response.status}).`)
      }
      return viewToStarted(response.result)
    },

    async startSubmission() {
      const startResp = await apiCall<RunnerSubmissionView>('/api/forms/form-submissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ form_key: formKey, subject_type: subjectType, subject_id: subjectId }),
      })
      if (!startResp.ok || !startResp.result) {
        throw makeError('UNKNOWN', `Failed to start submission (status ${startResp.status}).`)
      }
      return viewToStarted(startResp.result)
    },

    async save(submissionId, body) {
      const response = await apiCall<RunnerSaveResult>(
        `/api/forms/form-submissions/${encodeURIComponent(submissionId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      return { status: response.status, result: response.ok ? response.result : null }
    },

    async submit(submissionId, body) {
      const response = await apiCall<{ submission: RunnerSubmission }>(
        `/api/forms/form-submissions/${encodeURIComponent(submissionId)}/submit`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      return { status: response.status, result: response.ok ? response.result : null }
    },

    async uploadAttachment(submissionId, fieldKey, file) {
      const formData = buildUploadForm(fieldKey, file)
      const response = await apiCall<RunnerFileAttachmentRef>(
        `/api/forms/form-submissions/${encodeURIComponent(submissionId)}/attachments`,
        { method: 'POST', body: formData },
      )
      if (!response.ok || !response.result) {
        throw uploadError(response.status)
      }
      return response.result
    },

    attachmentDownloadUrl(submissionId, attachmentId) {
      return `/api/forms/submissions/${encodeURIComponent(submissionId)}/attachments/${encodeURIComponent(attachmentId)}`
    },

    async downloadPdf(submissionId) {
      await triggerPdfDownload(
        `/api/forms/submissions/${encodeURIComponent(submissionId)}/pdf`,
      )
    },
  }
}

function buildUploadForm(fieldKey: string, file: File): FormData {
  const formData = new FormData()
  formData.append('field_key', fieldKey)
  formData.append('file', file)
  return formData
}

function uploadError(status: number): RunnerLoadError {
  if (status === 401) return makeError('UNAUTHORIZED', 'Your session for this form has expired.')
  if (status === 413) return makeError('VALIDATION', 'The file is too large.')
  if (status === 422) return makeError('VALIDATION', 'The file type is not allowed.')
  return makeError('UNKNOWN', `Upload failed (status ${status}).`)
}

// ============================================================================
// Anonymous client — public token endpoints (`/api/forms/public/*`).
//
// The submission access token is held in a closure and refreshed every time a
// PATCH returns a fresh `access_token`. `loadActiveSchema` adapts the
// pre-resolved public form context (no network); `loadResumeCandidates` returns
// the started/linked submission in personal mode and an empty list in open
// mode (each open start is a fresh submission).
// ============================================================================

export type PublicFormContext = {
  distribution_id: string
  form: {
    key: string
    name: string
    defaultLocale: string
    supportedLocales: string[]
  }
  schema: RunnerSchema
  ui_schema: Record<string, unknown>
  fieldIndex: Record<string, RunnerFieldDescriptor>
  requires_customer_auth: boolean
  default_locale: string
  completion?: { title: string | null; message: string | null }
  redirect_url?: string | null
  /**
   * Public-safe embed display hints (spec D6). Present only for embeddable open
   * distributions; never carries the framing allowlist (`allowedDomains`).
   */
  embed?: { theme: 'light' | 'dark' | 'auto' | null; autoResize: boolean } | null
  invitation?: {
    id: string
    status: string
    locale: string | null
  }
}

export type PublicStartResponse = {
  submission: RunnerSubmission
  revision: RunnerRevision
  decoded_data: Record<string, unknown>
  access_token: string
  expires_at: string
}

export type CreateAnonymousRuntimeClientArgs = {
  context: PublicFormContext
  started?: PublicStartResponse
  accessToken: string
  mode: 'open' | 'personal'
  slug?: string
  token?: string
}

type PublicSaveResponse = {
  revision: RunnerRevision
  access_token?: string
}

type PublicGetResponse = {
  submission: RunnerSubmission
  revision: RunnerRevision
  decoded_data: Record<string, unknown>
  actors: RunnerActor[]
}

function authHeaders(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}` }
}

export function createAnonymousRuntimeClient(
  args: CreateAnonymousRuntimeClientArgs,
): RuntimeClient {
  const { context, mode, slug, token } = args
  let accessToken = args.accessToken
  let started = args.started

  function startedToState(payload: PublicStartResponse): RuntimeStartedState {
    return {
      submission: payload.submission,
      revision: payload.revision,
      decodedData: payload.decoded_data ?? {},
      actors: [],
    }
  }

  function activeSchema(): RunnerActiveFormResponse {
    const formVersionId = started?.submission.formVersionId ?? ''
    const roles = Array.isArray(context.schema['x-om-roles'])
      ? (context.schema['x-om-roles'] as string[])
      : []
    return {
      form: {
        id: context.distribution_id,
        key: context.form.key,
        name: context.form.name,
        defaultLocale: context.form.defaultLocale,
        supportedLocales: context.form.supportedLocales,
      },
      formVersion: {
        id: formVersionId,
        versionNumber: 1,
        schemaHash: '',
        registryVersion: '',
        roles,
      },
      schema: context.schema,
      uiSchema: context.ui_schema,
      fieldIndex: context.fieldIndex,
      callerRoles: roles,
    }
  }

  async function callStart(): Promise<PublicStartResponse> {
    const body: { slug?: string; token?: string; locale?: string } = {}
    if (mode === 'personal' && token) body.token = token
    else if (slug) body.slug = slug
    if (context.default_locale) body.locale = context.default_locale
    const response = await apiCall<PublicStartResponse>('/api/forms/public/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.status === 409) {
      throw makeError('UNAUTHORIZED', 'This form requires you to sign in.')
    }
    if (response.status === 410) {
      throw makeError('NOT_FOUND', 'This form is no longer available.')
    }
    if (!response.ok || !response.result) {
      throw makeError('UNKNOWN', `Failed to start submission (status ${response.status}).`)
    }
    return response.result
  }

  return {
    async loadActiveSchema() {
      return activeSchema()
    },

    async loadResumeCandidates() {
      if (mode === 'open') return []
      if (started) {
        const candidate = started.submission
        if (candidate.status === 'draft' || candidate.status === 'reopened') {
          return [candidate]
        }
      }
      return []
    },

    async loadSubmissionDetail(submissionId: string) {
      const response = await apiCall<PublicGetResponse>(
        `/api/forms/public/submissions/${encodeURIComponent(submissionId)}`,
        { headers: authHeaders(accessToken) },
      )
      if (response.status === 401) {
        throw makeError('UNAUTHORIZED', 'Your session for this form has expired.')
      }
      if (response.status === 404) {
        throw makeError('NOT_FOUND', 'Submission not found.')
      }
      if (!response.ok || !response.result) {
        throw makeError('UNKNOWN', `Failed to load submission (status ${response.status}).`)
      }
      return {
        submission: response.result.submission,
        revision: response.result.revision,
        decodedData: response.result.decoded_data ?? {},
        actors: response.result.actors ?? [],
      }
    },

    async startSubmission() {
      if (!started) {
        started = await callStart()
        accessToken = started.access_token
      }
      return startedToState(started)
    },

    async save(submissionId, body) {
      const response = await apiCall<PublicSaveResponse>(
        `/api/forms/public/submissions/${encodeURIComponent(submissionId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', ...authHeaders(accessToken) },
          body: JSON.stringify(body),
        },
      )
      if (response.ok && response.result) {
        if (response.result.access_token) accessToken = response.result.access_token
        return {
          status: response.status,
          result: { revision: response.result.revision, coalesced: false },
        }
      }
      return { status: response.status, result: null }
    },

    async submit(submissionId, body) {
      const response = await apiCall<{ submission: RunnerSubmission; redirect_url: string | null }>(
        `/api/forms/public/submissions/${encodeURIComponent(submissionId)}/submit`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...authHeaders(accessToken) },
          body: JSON.stringify(body),
        },
      )
      if (response.ok && response.result) {
        return { status: response.status, result: { submission: response.result.submission } }
      }
      return { status: response.status, result: null }
    },

    async uploadAttachment(submissionId, fieldKey, file) {
      const formData = buildUploadForm(fieldKey, file)
      const response = await apiCall<RunnerFileAttachmentRef>(
        `/api/forms/public/submissions/${encodeURIComponent(submissionId)}/attachments`,
        { method: 'POST', headers: authHeaders(accessToken), body: formData },
      )
      if (!response.ok || !response.result) {
        throw uploadError(response.status)
      }
      return response.result
    },

    attachmentDownloadUrl(submissionId, attachmentId) {
      return `/api/forms/public/submissions/${encodeURIComponent(submissionId)}/attachments/${encodeURIComponent(attachmentId)}`
    },

    async downloadPdf(submissionId) {
      await triggerPdfDownload(
        `/api/forms/public/submissions/${encodeURIComponent(submissionId)}/pdf`,
        authHeaders(accessToken),
      )
    },
  }
}
