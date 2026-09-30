"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePortalAppEvent } from '@open-mercato/ui/portal/hooks/usePortalAppEvent'
import type {
  RunnerActiveFormResponse,
  RunnerActor,
  RunnerErrorCode,
  RunnerFieldDescriptor,
  RunnerLoadError,
  RunnerRevision,
  RunnerSaveState,
  RunnerSchema,
  RunnerSection,
  RunnerSubmission,
} from '../types'
import { mergeOnConflict, useAutosave } from './useAutosave'
import { createAuthRuntimeClient, type RuntimeClient } from './runtime-client'
import { collectMissingRequired, deriveLogicState } from './logic-derivation'
import type { LogicState } from '../../../services/form-logic-evaluator'

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
  /**
   * Transport client backing the six runtime operations. Omitted ⇒ the default
   * authenticated client that calls `/api/forms/form-submissions` and the
   * by-key active-schema endpoint (the shipped portal flow, unchanged).
   */
  client?: RuntimeClient
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
  /**
   * Live reactive logic state derived from the current answers — conditional
   * visibility (`x-om-visibility-if`), computed variables (`x-om-variables`),
   * recall-token resolution, and section jumps (`x-om-jumps`). `null` until a
   * schema is loaded. Mirrors the reactive runner's `evaluateFormLogic` so the
   * public runner converges on the same behaviour (R-6).
   */
  logicState: LogicState | null
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
  /** Active transport client — exposed so file fields can build an uploader. */
  client: RuntimeClient
}

export function useFormRunner(args: UseFormRunnerArgs): UseFormRunnerResult {
  const {
    formKey,
    subjectType,
    subjectId,
    initialSubmissionId,
    autosaveIntervalMs = DEFAULT_AUTOSAVE_MS,
  } = args

  const client = useMemo<RuntimeClient>(
    () => args.client ?? createAuthRuntimeClient({ formKey, subjectType, subjectId }),
    [args.client, formKey, subjectType, subjectId],
  )

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

  // Reactive logic state — recomputed whenever answers change so conditional
  // visibility, variables, recall, and jumps stay live (matches the reactive
  // runner). The public transport carries no hidden values, so we pass `{}`;
  // `evaluateFormLogic` still applies declared hidden-field defaults.
  const logicState = useMemo<LogicState | null>(
    () => deriveLogicState({ schema, values, hidden: {}, locale }),
    [schema, values, locale],
  )

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
    return client.loadActiveSchema()
  }, [client])

  const loadSubmissionsBySubject = useCallback(async () => {
    return client.loadResumeCandidates()
  }, [client])

  const loadSubmissionDetail = useCallback(async (submissionId: string): Promise<StartedState> => {
    return client.loadSubmissionDetail(submissionId)
  }, [client])

  const startNewSubmission = useCallback(async () => {
    setSaveState({ status: 'idle' })
    const started = await client.startSubmission()
    captureStarted(started)
    setStage('ready')
    setCurrentSectionIndex(0)
  }, [client, captureStarted])

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
      const started = await client.startSubmission()
      if (cancelled) return
      captureStarted(started)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [
    client,
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
      const response = await client.save(submission.id, {
        base_revision_id: submissionRevision.id,
        patch: dirtySnapshot,
      })
      if (response.status === 409) {
        await handleConflict()
        return
      }
      if (response.status < 200 || response.status >= 300 || !response.result) {
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
  }, [client, submission, submissionRevision])

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
  // Required-field gating ignores fields hidden by `x-om-visibility-if`: a
  // hidden required field must not block Next / submit (converges with the
  // reactive runner and aligns the client with T1's server-side slicing).
  const validateSection = useCallback((sectionIndex: number): string[] => {
    if (!schemaResponse || !schema) return []
    const section = sections[sectionIndex]
    if (!section) return []
    return collectMissingRequired({
      schema,
      fieldIndex: schemaResponse.fieldIndex,
      sectionFieldKeys: section.fieldKeys,
      values,
      visibleFieldKeys: logicState ? logicState.visibleFieldKeys : null,
    })
  }, [schema, schemaResponse, sections, values, logicState])

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
      const response = await client.submit(submission.id, {
        base_revision_id: submissionRevisionRef.current?.id ?? submissionRevision.id,
        submit_metadata: { locale },
      })
      if (response.status === 409) {
        await handleConflict()
        setStage('review')
        return
      }
      if (response.status < 200 || response.status >= 300 || !response.result) {
        throw new Error(`Failed to submit (status ${response.status}).`)
      }
      setSubmission(response.result.submission)
      setStage('completed')
    } catch (error) {
      setSaveState({ status: 'error', message: extractErrorMessage(error) })
      setStage('review')
    }
  }, [client, submission, submissionRevision, flushAutosave, locale, handleConflict])

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
    logicState,
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
    client,
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
