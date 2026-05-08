"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { usePortalAppEvent } from '@open-mercato/ui/portal/hooks/usePortalAppEvent'
import type {
  RunnerActiveFormResponse,
  RunnerActor,
  RunnerErrorCode,
  RunnerFieldDescriptor,
  RunnerLoadError,
  RunnerRevision,
  RunnerSaveResult,
  RunnerSaveState,
  RunnerSchema,
  RunnerSection,
  RunnerSubmission,
  RunnerSubmissionView,
} from '../types'
import { mergeOnConflict, useAutosave } from './useAutosave'

const DEFAULT_AUTOSAVE_MS = (() => {
  const raw =
    typeof process !== 'undefined' && process.env
      ? process.env.NEXT_PUBLIC_FORMS_AUTOSAVE_INTERVAL_MS ?? process.env.FORMS_AUTOSAVE_INTERVAL_MS
      : undefined
  if (!raw) return 10_000
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000
})()

export type RunnerStage =
  | 'loading'
  | 'resume_gate'
  | 'ready'
  | 'review'
  | 'submitting'
  | 'completed'
  | 'error'

export type SubmissionListItem = RunnerSubmission

export type UseFormRunnerArgs = {
  formKey: string
  subjectType: string
  subjectId: string
  /** Pre-existing submission id, when resuming via `/submissions/:id/continue`. */
  initialSubmissionId?: string
  /** Override the autosave debounce (ms). Defaults to FORMS_AUTOSAVE_INTERVAL_MS or 10s. */
  autosaveIntervalMs?: number
}

type StartedState = {
  submission: RunnerSubmission
  revision: RunnerRevision
  decodedData: Record<string, unknown>
  actors: RunnerActor[]
}

export type UseFormRunnerResult = {
  stage: RunnerStage
  loadError: RunnerLoadError | null
  saveState: RunnerSaveState
  schemaResponse: RunnerActiveFormResponse | null
  schema: RunnerSchema | null
  sections: RunnerSection[]
  fieldOrder: string[]
  visibleFieldIndex: Record<string, RunnerFieldDescriptor>
  submission: RunnerSubmission | null
  submissionRevision: RunnerRevision | null
  submissionActors: RunnerActor[]
  decodedData: Record<string, unknown>
  values: Record<string, unknown>
  conflictKeys: string[]
  resumeCandidates: RunnerSubmission[]
  currentSectionIndex: number
  setCurrentSectionIndex: (next: number) => void
  setFieldValue: (fieldKey: string, value: unknown) => void
  locale: string
  setLocale: (next: string) => void
  startNewSubmission: () => Promise<void>
  resumeExistingSubmission: (submissionId: string) => Promise<void>
  enterReview: () => void
  exitReview: () => void
  submit: () => Promise<void>
  validateSection: (sectionIndex: number) => string[]
  flushAutosave: () => Promise<void>
}

const FALLBACK_FIELD: RunnerFieldDescriptor = {
  key: '',
  type: 'text',
  sectionKey: null,
  sensitive: false,
  editableBy: [],
  visibleTo: [],
  required: false,
}

export function useFormRunner(args: UseFormRunnerArgs): UseFormRunnerResult {
  const {
    formKey,
    subjectType,
    subjectId,
    initialSubmissionId,
    autosaveIntervalMs = DEFAULT_AUTOSAVE_MS,
  } = args

  const [stage, setStage] = useState<RunnerStage>('loading')
  const [loadError, setLoadError] = useState<RunnerLoadError | null>(null)
  const [schemaResponse, setSchemaResponse] = useState<RunnerActiveFormResponse | null>(null)
  const [submission, setSubmission] = useState<RunnerSubmission | null>(null)
  const [submissionRevision, setSubmissionRevision] = useState<RunnerRevision | null>(null)
  const [submissionActors, setSubmissionActors] = useState<RunnerActor[]>([])
  const [decodedData, setDecodedData] = useState<Record<string, unknown>>({})
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [resumeCandidates, setResumeCandidates] = useState<RunnerSubmission[]>([])
  const [conflictKeys, setConflictKeys] = useState<string[]>([])
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0)
  const [locale, setLocaleState] = useState<string>('en')
  const [saveState, setSaveState] = useState<RunnerSaveState>({ status: 'idle' })
  const [dirtyKey, setDirtyKey] = useState(0)

  const dirtyFieldsRef = useRef<Record<string, unknown>>({})
  const baseSnapshotRef = useRef<Record<string, unknown>>({})
  const flushingRef = useRef(false)

  const schema = schemaResponse?.schema ?? null
  const sections: RunnerSection[] = useMemo(() => {
    if (!schema) return []
    const declared = Array.isArray(schema['x-om-sections']) ? schema['x-om-sections'] : []
    if (declared.length > 0) return declared
    if (schema.properties) {
      const allKeys = Object.keys(schema.properties)
      return [
        { key: '__default', title: { en: 'Form' }, fieldKeys: allKeys },
      ]
    }
    return []
  }, [schema])

  const fieldOrder = useMemo(() => {
    if (!schema?.properties) return []
    const keys = Object.keys(schema.properties)
    if (sections.length === 0) return keys
    const ordered: string[] = []
    const seen = new Set<string>()
    for (const section of sections) {
      for (const key of section.fieldKeys) {
        if (keys.includes(key) && !seen.has(key)) {
          ordered.push(key)
          seen.add(key)
        }
      }
    }
    for (const key of keys) {
      if (!seen.has(key)) ordered.push(key)
    }
    return ordered
  }, [schema, sections])

  const visibleFieldIndex = useMemo(() => {
    if (!schemaResponse) return {}
    return schemaResponse.fieldIndex
  }, [schemaResponse])

  const setLocale = useCallback((next: string) => {
    setLocaleState(next)
  }, [])

  const setCurrentSection = useCallback((next: number) => {
    setCurrentSectionIndex(next)
  }, [])

  const captureStarted = useCallback((started: StartedState) => {
    setSubmission(started.submission)
    setSubmissionRevision(started.revision)
    setSubmissionActors(started.actors)
    setDecodedData(started.decodedData)
    setValues({ ...started.decodedData })
    baseSnapshotRef.current = { ...started.decodedData }
    dirtyFieldsRef.current = {}
    setConflictKeys([])
    setSaveState({ status: 'idle' })
  }, [])

  const loadActiveSchema = useCallback(async () => {
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
  }, [formKey])

  const loadSubmissionsBySubject = useCallback(async () => {
    const response = await apiCall<{ items: RunnerSubmission[] }>(
      `/api/forms/form-submissions/by-subject/${encodeURIComponent(subjectType)}/${encodeURIComponent(subjectId)}`,
    )
    if (!response.ok || !response.result) return []
    return response.result.items.filter((entry) => entry.status === 'draft' || entry.status === 'reopened')
  }, [subjectType, subjectId])

  const loadSubmissionDetail = useCallback(async (submissionId: string): Promise<StartedState> => {
    const response = await apiCall<RunnerSubmissionView>(
      `/api/forms/form-submissions/${encodeURIComponent(submissionId)}`,
    )
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
  }, [])

  const startNewSubmission = useCallback(async () => {
    setSaveState({ status: 'idle' })
    const startResp = await apiCall<RunnerSubmissionView>('/api/forms/form-submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ form_key: formKey, subject_type: subjectType, subject_id: subjectId }),
    })
    if (!startResp.ok || !startResp.result) {
      throw makeError('UNKNOWN', `Failed to start submission (status ${startResp.status}).`)
    }
    captureStarted({
      submission: startResp.result.submission,
      revision: startResp.result.revision,
      decodedData: startResp.result.decoded_data ?? {},
      actors: startResp.result.actors ?? [],
    })
    setStage('ready')
    setCurrentSectionIndex(0)
  }, [formKey, subjectType, subjectId, captureStarted])

  const resumeExistingSubmission = useCallback(async (submissionId: string) => {
    setSaveState({ status: 'idle' })
    const view = await loadSubmissionDetail(submissionId)
    captureStarted(view)
    setStage('ready')
    setCurrentSectionIndex(0)
  }, [loadSubmissionDetail, captureStarted])

  // ---------- Initial load ----------
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const schemaResp = await loadActiveSchema()
        if (cancelled) return
        setSchemaResponse(schemaResp)
        setLocaleState((prev) => (prev === 'en' ? schemaResp.form.defaultLocale : prev))

        if (initialSubmissionId) {
          const view = await loadSubmissionDetail(initialSubmissionId)
          if (cancelled) return
          captureStarted(view)
          setStage('ready')
          return
        }

        const candidates = await loadSubmissionsBySubject()
        if (cancelled) return
        setResumeCandidates(candidates)
        if (candidates.length > 0) {
          setStage('resume_gate')
        } else {
          setStage('ready')
          // Auto-start a new submission so the renderer can show fields immediately.
          try {
            await startNewSubmissionInternal(schemaResp)
          } catch (error) {
            if (!cancelled) {
              const err = isRunnerError(error)
                ? error
                : makeError('UNKNOWN', extractErrorMessage(error))
              setLoadError(err)
              setStage('error')
            }
          }
        }
      } catch (error) {
        if (cancelled) return
        const err = isRunnerError(error)
          ? error
          : makeError('UNKNOWN', extractErrorMessage(error))
        setLoadError(err)
        setStage('error')
      }
    }

    async function startNewSubmissionInternal(_schemaResp: RunnerActiveFormResponse) {
      const startResp = await apiCall<RunnerSubmissionView>('/api/forms/form-submissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ form_key: formKey, subject_type: subjectType, subject_id: subjectId }),
      })
      if (cancelled) return
      if (!startResp.ok || !startResp.result) {
        throw makeError('UNKNOWN', `Failed to start submission (status ${startResp.status}).`)
      }
      captureStarted({
        submission: startResp.result.submission,
        revision: startResp.result.revision,
        decodedData: startResp.result.decoded_data ?? {},
        actors: startResp.result.actors ?? [],
      })
    }

    load()
    return () => {
      cancelled = true
    }
  }, [
    formKey,
    subjectType,
    subjectId,
    initialSubmissionId,
    loadActiveSchema,
    loadSubmissionDetail,
    loadSubmissionsBySubject,
    captureStarted,
  ])

  // ---------- Field updates ----------
  const setFieldValue = useCallback((fieldKey: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldKey]: value }))
    dirtyFieldsRef.current = { ...dirtyFieldsRef.current, [fieldKey]: value }
    setConflictKeys((prev) => prev.filter((entry) => entry !== fieldKey))
    setSaveState({ status: 'dirty' })
    setDirtyKey((prev) => prev + 1)
  }, [])

  // ---------- Autosave flush ----------
  const flushAutosave = useCallback(async () => {
    if (flushingRef.current) return
    if (!submission || !submissionRevision) return
    if (Object.keys(dirtyFieldsRef.current).length === 0) return
    flushingRef.current = true
    setSaveState({ status: 'saving' })
    const dirtySnapshot = { ...dirtyFieldsRef.current }
    try {
      const response = await apiCall<RunnerSaveResult>(
        `/api/forms/form-submissions/${encodeURIComponent(submission.id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            base_revision_id: submissionRevision.id,
            patch: dirtySnapshot,
          }),
        },
      )
      if (response.status === 409) {
        await handleConflict()
        return
      }
      if (!response.ok || !response.result) {
        throw new Error(`Failed to save (status ${response.status}).`)
      }
      const nextRevision = response.result.revision
      setSubmissionRevision(nextRevision)
      // Drop fields that just persisted from the dirty set (only those that
      // didn't change again while the request was in flight).
      const remaining: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(dirtyFieldsRef.current)) {
        if (!shallowEqual(value, dirtySnapshot[key])) remaining[key] = value
      }
      dirtyFieldsRef.current = remaining
      baseSnapshotRef.current = { ...baseSnapshotRef.current, ...dirtySnapshot }
      const stamp = new Date().toISOString()
      if (Object.keys(remaining).length > 0) {
        setSaveState({ status: 'dirty' })
      } else {
        setSaveState({ status: 'saved', savedAt: stamp })
      }
    } catch (error) {
      setSaveState({ status: 'error', message: extractErrorMessage(error) })
    } finally {
      flushingRef.current = false
    }
  }, [submission, submissionRevision])

  const handleConflict = useCallback(async () => {
    if (!submission) return
    try {
      const view = await loadSubmissionDetail(submission.id)
      const merged = mergeOnConflict({
        localDirty: { ...dirtyFieldsRef.current },
        baseSnapshot: { ...baseSnapshotRef.current },
        serverFresh: view.decodedData,
      })
      setSubmission(view.submission)
      setSubmissionRevision(view.revision)
      setSubmissionActors(view.actors)
      setDecodedData(view.decodedData)
      setValues(merged.merged)
      baseSnapshotRef.current = { ...view.decodedData }
      setConflictKeys(merged.conflictingKeys)
      // After merge, treat dirty fields as still dirty so the next flush retries with the new base.
      dirtyFieldsRef.current = { ...merged.merged }
      const message = merged.conflictingKeys.length > 0
        ? 'We refreshed the form to merge a change made elsewhere.'
        : 'Refreshed to the latest version.'
      setSaveState({ status: 'conflict', message })
      setDirtyKey((prev) => prev + 1)
    } catch (error) {
      setSaveState({ status: 'error', message: extractErrorMessage(error) })
    }
  }, [submission, loadSubmissionDetail])

  useAutosave({
    dirtyKey,
    enabled: stage === 'ready' && !!submission,
    intervalMs: autosaveIntervalMs,
    onFlush: flushAutosave,
  })

  // Cross-tab sync: another tab saved or submitted this submission.
  usePortalAppEvent(
    'forms.submission.revision_appended',
    (payload) => {
      const target = (payload as { submissionId?: string }).submissionId
      if (!submission || !target || target !== submission.id) return
      if (flushingRef.current) return
      void handleConflict()
    },
    [submission?.id],
  )

  usePortalAppEvent(
    'forms.submission.submitted',
    (payload) => {
      const target = (payload as { submissionId?: string }).submissionId
      if (!submission || !target || target !== submission.id) return
      setStage('completed')
    },
    [submission?.id],
  )

  // ---------- Validation per section ----------
  const validateSection = useCallback((sectionIndex: number): string[] => {
    if (!schemaResponse || !schema) return []
    const section = sections[sectionIndex]
    if (!section) return []
    const required = Array.isArray(schema.required) ? schema.required : []
    const requiredSet = new Set(required)
    const missing: string[] = []
    for (const fieldKey of section.fieldKeys) {
      if (!requiredSet.has(fieldKey)) continue
      const descriptor = schemaResponse.fieldIndex[fieldKey] ?? FALLBACK_FIELD
      if (descriptor.type === 'info_block') continue
      const value = values[fieldKey]
      if (value === undefined || value === null) {
        missing.push(fieldKey)
        continue
      }
      if (typeof value === 'string' && value.trim().length === 0) {
        missing.push(fieldKey)
        continue
      }
      if (Array.isArray(value) && value.length === 0) {
        missing.push(fieldKey)
        continue
      }
    }
    return missing
  }, [schema, schemaResponse, sections, values])

  const enterReview = useCallback(() => {
    setStage('review')
  }, [])

  const exitReview = useCallback(() => {
    setStage('ready')
  }, [])

  const submit = useCallback(async () => {
    if (!submission || !submissionRevision) return
    setStage('submitting')
    try {
      // Always flush local edits first so the submit metadata reflects the
      // latest revision id.
      if (Object.keys(dirtyFieldsRef.current).length > 0) {
        await flushAutosave()
      }
      const response = await apiCall<{ submission: RunnerSubmission }>(
        `/api/forms/form-submissions/${encodeURIComponent(submission.id)}/submit`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            base_revision_id: submissionRevisionRef.current?.id ?? submissionRevision.id,
            submit_metadata: { locale },
          }),
        },
      )
      if (response.status === 409) {
        await handleConflict()
        setStage('review')
        return
      }
      if (!response.ok || !response.result) {
        throw new Error(`Failed to submit (status ${response.status}).`)
      }
      setSubmission(response.result.submission)
      setStage('completed')
    } catch (error) {
      setSaveState({ status: 'error', message: extractErrorMessage(error) })
      setStage('review')
    }
  }, [submission, submissionRevision, flushAutosave, locale, handleConflict])

  // Keep a ref to the latest submission revision so `submit` can read the
  // post-flush id without re-binding the callback.
  const submissionRevisionRef = useRef<RunnerRevision | null>(submissionRevision)
  useEffect(() => {
    submissionRevisionRef.current = submissionRevision
  }, [submissionRevision])

  return {
    stage,
    loadError,
    saveState,
    schemaResponse,
    schema,
    sections,
    fieldOrder,
    visibleFieldIndex,
    submission,
    submissionRevision,
    submissionActors,
    decodedData,
    values,
    conflictKeys,
    resumeCandidates,
    currentSectionIndex,
    setCurrentSectionIndex: setCurrentSection,
    setFieldValue,
    locale,
    setLocale,
    startNewSubmission,
    resumeExistingSubmission,
    enterReview,
    exitReview,
    submit,
    validateSection,
    flushAutosave,
  }
}

// ============================================================================
// Helpers
// ============================================================================

function makeError(code: RunnerErrorCode, message: string): RunnerLoadError {
  return { code, message }
}

function isRunnerError(value: unknown): value is RunnerLoadError {
  return !!value && typeof value === 'object' && 'code' in (value as Record<string, unknown>) && 'message' in (value as Record<string, unknown>)
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (isRunnerError(error)) return error.message
  return 'Unknown error.'
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
      if (!shallowEqual(a[i], b[i])) return false
    }
    return true
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as Record<string, unknown>)
    const bKeys = Object.keys(b as Record<string, unknown>)
    if (aKeys.length !== bKeys.length) return false
    for (const key of aKeys) {
      if (!shallowEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
        return false
      }
    }
    return true
  }
  return false
}
