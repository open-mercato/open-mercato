/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'
import { reportTelemetryError } from '@open-mercato/shared/lib/telemetry/runtime'
import { useFormRunner } from '../ui/public/state/useFormRunner'
import type { RuntimeClient, RuntimeStartedState } from '../ui/public/state/runtime-client'
import type { RunnerActiveFormResponse } from '../ui/public/types'

jest.mock('@open-mercato/ui/portal/hooks/usePortalAppEvent', () => ({ usePortalAppEvent: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string) => key }))
jest.mock('../ui/public/state/useAutosave', () => ({ useAutosave: jest.fn(), mergeOnConflict: jest.fn() }))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ reportTelemetryError: jest.fn() }))

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function started(id: string): RuntimeStartedState {
  return {
    submission: {
      id, organizationId: 'organization', tenantId: 'tenant', formVersionId: 'version',
      subjectType: 'customer', subjectId: 'subject', status: 'draft', currentRevisionId: `${id}-revision`,
      startedBy: 'user', submittedBy: null, firstSavedAt: null, submittedAt: null,
      submitMetadata: null, pdfSnapshotAttachmentId: null, anonymizedAt: null,
      createdAt: null, updatedAt: null,
    },
    revision: {
      id: `${id}-revision`, submissionId: id, revisionNumber: 1, encryptionKeyVersion: null,
      savedAt: null, savedBy: 'user', savedByRole: null, changeSource: 'user',
      changedFieldKeys: [], changeSummary: null, anonymizedAt: null,
    },
    decodedData: { answer: id }, actors: [],
  }
}

function client(formId: string): jest.Mocked<RuntimeClient> {
  const schema: RunnerActiveFormResponse = {
    form: { id: formId, key: formId, name: formId, defaultLocale: 'en', supportedLocales: ['en'] },
    formVersion: { id: 'version', versionNumber: 1, schemaHash: 'hash', registryVersion: '1', roles: [] },
    schema: { properties: { answer: { type: 'string' } } }, uiSchema: {}, fieldIndex: {}, callerRoles: [],
  }
  return {
    loadActiveSchema: jest.fn().mockResolvedValue(schema),
    loadResumeCandidates: jest.fn().mockResolvedValue([started('candidate').submission]),
    loadSubmissionDetail: jest.fn().mockResolvedValue(started('resumed')),
    startSubmission: jest.fn().mockResolvedValue(started('new')),
    save: jest.fn(), submit: jest.fn(), uploadAttachment: jest.fn(),
    attachmentDownloadUrl: jest.fn(), downloadPdf: jest.fn(),
  }
}

const scope = { formKey: 'intake', subjectType: 'customer', subjectId: 'subject' }

describe('form runner draft transitions', () => {
  it('reports a current resume failure while showing the runner error', async () => {
    jest.mocked(reportTelemetryError).mockClear()
    const runtime = client('form')
    const error = new Error('resume unavailable')
    runtime.loadSubmissionDetail.mockRejectedValueOnce(error)
    const { result } = renderHook(() => useFormRunner({ ...scope, client: runtime }))
    await waitFor(() => expect(result.current.stage).toBe('resume_gate'))

    await act(() => result.current.resumeExistingSubmission('candidate'))

    expect(result.current.stage).toBe('error')
    expect(result.current.loadError?.message).toBe(error.message)
    expect(reportTelemetryError).toHaveBeenCalledWith(error, {
      module: 'forms', code: 'forms.runner_resume_failed',
    })
  })

  it('does not report a superseded resume failure after starting another draft', async () => {
    jest.mocked(reportTelemetryError).mockClear()
    const runtime = client('form')
    const pendingResume = deferred<RuntimeStartedState>()
    runtime.loadSubmissionDetail.mockReturnValueOnce(pendingResume.promise)
    const { result } = renderHook(() => useFormRunner({ ...scope, client: runtime }))
    await waitFor(() => expect(result.current.stage).toBe('resume_gate'))
    let resume!: Promise<void>
    act(() => { resume = result.current.resumeExistingSubmission('candidate') })
    await act(() => result.current.startNewSubmission())

    await act(async () => { pendingResume.reject(new Error('superseded')); await resume })

    expect(result.current.stage).toBe('ready')
    expect(result.current.submission?.id).toBe('new')
    expect(result.current.loadError).toBeNull()
    expect(reportTelemetryError).not.toHaveBeenCalled()
  })

  it('reloads a changed subject even when the supplied runtime client is stable', async () => {
    const runtime = client('form')
    const pendingStart = deferred<RuntimeStartedState>()
    runtime.loadResumeCandidates.mockResolvedValueOnce([started('candidate').submission])
    runtime.loadResumeCandidates.mockResolvedValue([])
    runtime.startSubmission.mockReturnValue(pendingStart.promise)
    const { result, rerender } = renderHook(({ subjectId }) => useFormRunner({
      ...scope,
      subjectId,
      client: runtime,
    }), { initialProps: { subjectId: scope.subjectId } })
    await waitFor(() => expect(result.current.stage).toBe('resume_gate'))
    await act(() => result.current.resumeExistingSubmission('candidate'))

    rerender({ subjectId: 'next-subject' })
    await waitFor(() => expect(runtime.startSubmission).toHaveBeenCalledTimes(1))
    expect(result.current.stage).toBe('loading')
    expect(result.current.submission).toBeNull()
    expect(result.current.values).toEqual({})

    const next = started('next-scope')
    next.submission.subjectId = 'next-subject'
    await act(async () => pendingStart.resolve(next))
    expect(result.current.stage).toBe('ready')
    expect(result.current.submission?.subjectId).toBe('next-subject')
  })

  it('clears the previous draft and stays loading until the new scope starts its submission', async () => {
    const previousClient = client('previous-form')
    const nextClient = client('next-form')
    nextClient.loadResumeCandidates.mockResolvedValue([])
    const pendingStart = deferred<RuntimeStartedState>()
    nextClient.startSubmission.mockReturnValue(pendingStart.promise)
    const { result, rerender } = renderHook(({ runtime }) => useFormRunner({ ...scope, client: runtime }), {
      initialProps: { runtime: previousClient },
    })
    await waitFor(() => expect(result.current.stage).toBe('resume_gate'))
    await act(() => result.current.resumeExistingSubmission('candidate'))
    act(() => result.current.setFieldValue('answer', 'unsaved previous answer'))

    rerender({ runtime: nextClient })
    await waitFor(() => expect(nextClient.startSubmission).toHaveBeenCalledTimes(1))
    expect(result.current.stage).toBe('loading')
    expect(result.current.submission).toBeNull()
    expect(result.current.submissionRevision).toBeNull()
    expect(result.current.values).toEqual({})
    await act(() => result.current.flushAutosave())
    expect(previousClient.save).not.toHaveBeenCalled()
    expect(nextClient.save).not.toHaveBeenCalled()

    await act(async () => pendingStart.resolve(started('next-scope')))
    expect(result.current.stage).toBe('ready')
    expect(result.current.submission?.id).toBe('next-scope')
    expect(result.current.values).toEqual({ answer: 'next-scope' })
  })

  it('keeps the last Start over choice when an earlier Continue response arrives later', async () => {
    const runtime = client('form')
    const pendingResume = deferred<RuntimeStartedState>()
    runtime.loadSubmissionDetail.mockReturnValue(pendingResume.promise)
    const { result } = renderHook(() => useFormRunner({ ...scope, client: runtime }))
    await waitFor(() => expect(result.current.stage).toBe('resume_gate'))
    let resume!: Promise<void>
    act(() => { resume = result.current.resumeExistingSubmission('candidate') })
    expect(result.current.stage).toBe('loading')
    await act(() => result.current.startNewSubmission())
    act(() => result.current.setFieldValue('answer', 'new answer'))

    await act(async () => { pendingResume.resolve(started('old-draft')); await resume })
    expect(result.current.submission?.id).toBe('new')
    expect(result.current.values).toEqual({ answer: 'new answer' })
  })

  it('keeps the last Continue choice when an earlier Start over response arrives later', async () => {
    const runtime = client('form')
    const pendingStart = deferred<RuntimeStartedState>()
    runtime.startSubmission.mockReturnValue(pendingStart.promise)
    const { result } = renderHook(() => useFormRunner({ ...scope, client: runtime }))
    await waitFor(() => expect(result.current.stage).toBe('resume_gate'))
    let start!: Promise<void>
    act(() => { start = result.current.startNewSubmission() })
    await act(() => result.current.resumeExistingSubmission('candidate'))
    act(() => result.current.setFieldValue('answer', 'continued answer'))

    await act(async () => { pendingStart.resolve(started('unselected-new')); await start })
    expect(result.current.submission?.id).toBe('resumed')
    expect(result.current.values).toEqual({ answer: 'continued answer' })
  })

  it('ignores a pending start response after the runner changes scope', async () => {
    const previousClient = client('previous-form')
    const nextClient = client('next-form')
    const pendingStart = deferred<RuntimeStartedState>()
    previousClient.startSubmission.mockReturnValue(pendingStart.promise)
    const { result, rerender } = renderHook(({ runtime }) => useFormRunner({ ...scope, client: runtime }), {
      initialProps: { runtime: previousClient },
    })
    await waitFor(() => expect(result.current.stage).toBe('resume_gate'))
    let start!: Promise<void>
    act(() => { start = result.current.startNewSubmission() })
    rerender({ runtime: nextClient })
    await waitFor(() => expect(result.current.schemaResponse?.form.id).toBe('next-form'))
    await act(() => result.current.resumeExistingSubmission('candidate'))

    await act(async () => { pendingStart.resolve(started('previous-scope')); await start })
    expect(result.current.stage).toBe('ready')
    expect(result.current.submission?.id).toBe('resumed')
  })

  it('ignores an old autosave response after installing a draft for a new scope', async () => {
    const previousClient = client('previous-form')
    const nextClient = client('next-form')
    const pendingSave = deferred<Awaited<ReturnType<RuntimeClient['save']>>>()
    previousClient.save.mockReturnValue(pendingSave.promise)
    const { result, rerender } = renderHook(({ runtime }) => useFormRunner({ ...scope, client: runtime }), {
      initialProps: { runtime: previousClient },
    })
    await waitFor(() => expect(result.current.stage).toBe('resume_gate'))
    await act(() => result.current.resumeExistingSubmission('candidate'))
    act(() => result.current.setFieldValue('answer', 'previous change'))
    let save!: Promise<void>
    act(() => { save = result.current.flushAutosave() })
    rerender({ runtime: nextClient })
    await waitFor(() => expect(result.current.stage).toBe('resume_gate'))
    await act(() => result.current.resumeExistingSubmission('candidate'))
    act(() => result.current.setFieldValue('answer', 'next change'))

    await act(async () => {
      pendingSave.resolve({ status: 200, result: { revision: started('previous').revision, coalesced: false } })
      await save
    })
    expect(result.current.submissionRevision?.submissionId).toBe('resumed')
    expect(result.current.values).toEqual({ answer: 'next change' })
    expect(result.current.saveState.status).toBe('dirty')
  })

  it('ignores an old submit response after the runner changes scope', async () => {
    const previousClient = client('previous-form')
    const nextClient = client('next-form')
    const pendingSubmit = deferred<Awaited<ReturnType<RuntimeClient['submit']>>>()
    previousClient.submit.mockReturnValue(pendingSubmit.promise)
    const { result, rerender } = renderHook(({ runtime }) => useFormRunner({ ...scope, client: runtime }), {
      initialProps: { runtime: previousClient },
    })
    await waitFor(() => expect(result.current.stage).toBe('resume_gate'))
    await act(() => result.current.resumeExistingSubmission('candidate'))
    let submit!: Promise<void>
    act(() => { submit = result.current.submit() })
    rerender({ runtime: nextClient })
    await waitFor(() => expect(result.current.stage).toBe('resume_gate'))
    await act(() => result.current.resumeExistingSubmission('candidate'))

    await act(async () => {
      pendingSubmit.resolve({ status: 200, result: { submission: { ...started('previous').submission, status: 'submitted' } } })
      await submit
    })
    expect(result.current.stage).toBe('ready')
    expect(result.current.submission?.id).toBe('resumed')
  })

  it('ignores an older failed action after a newer action succeeds', async () => {
    const runtime = client('form')
    const pendingStart = deferred<RuntimeStartedState>()
    runtime.startSubmission.mockReturnValue(pendingStart.promise)
    const { result } = renderHook(() => useFormRunner({ ...scope, client: runtime }))
    await waitFor(() => expect(result.current.stage).toBe('resume_gate'))
    let start!: Promise<void>
    act(() => { start = result.current.startNewSubmission() })
    await act(() => result.current.resumeExistingSubmission('candidate'))

    await act(async () => { pendingStart.reject(new Error('superseded')); await start })
    expect(result.current.stage).toBe('ready')
    expect(result.current.loadError).toBeNull()
    expect(result.current.submission?.id).toBe('resumed')
  })
})
