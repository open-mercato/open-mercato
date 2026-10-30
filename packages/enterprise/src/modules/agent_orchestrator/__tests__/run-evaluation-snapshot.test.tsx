/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import en from '../i18n/en.json'
import {
  RunEvaluationDrawer,
  SNAPSHOT_LATEST,
  SNAPSHOT_NONE,
  buildEvalRunRequestBody,
  canSubmitEvalRun,
  knownSnapshotHashes,
  shortSnapshotHash,
} from '../backend/agents/[id]/components/RunEvaluationDrawer'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(async () => ({ suiteRunId: 'suite-1' })),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

const dict = en as Record<string, string>
const AGENT_ID = 'deals.health_check'
const CASE_ID = '44444444-4444-4444-8444-444444444444'
const KNOWN_HASH = 'sha256:known0123456789digest'
const OLDER_HASH = 'sha256:older0123456789digest'

const apiCallMock = apiCall as jest.Mock
const apiCallOrThrowMock = apiCallOrThrow as jest.Mock

function mockLists(caseItems: Array<Record<string, unknown>> = [{ id: CASE_ID, process_type: 'deal_review' }]) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/agent_orchestrator/eval-cases')) {
      return { ok: true, status: 200, result: { items: caseItems } }
    }
    return {
      ok: true,
      status: 200,
      result: {
        items: [
          { id: 'run-2', eval_set_version: KNOWN_HASH, manifest_hash: KNOWN_HASH },
          { id: 'run-1', eval_set_version: 'release-1', manifest_hash: OLDER_HASH },
          { id: 'run-0', eval_set_version: null, manifest_hash: null },
        ],
      },
    }
  })
}

function sentBody(): Record<string, unknown> {
  const [, init] = apiCallOrThrowMock.mock.calls[0] as [string, { body: string }]
  return JSON.parse(init.body) as Record<string, unknown>
}

function renderDrawer() {
  return renderWithProviders(
    <RunEvaluationDrawer open onOpenChange={jest.fn()} agentId={AGENT_ID} agentLabel="Deal health" onStarted={jest.fn()} />,
    { dict },
  )
}

beforeAll(() => {
  const pointerCaptureTarget = Element.prototype as Element & {
    hasPointerCapture?: (pointerId: number) => boolean
    releasePointerCapture?: (pointerId: number) => void
    scrollIntoView?: () => void
  }
  pointerCaptureTarget.hasPointerCapture ??= () => false
  pointerCaptureTarget.releasePointerCapture ??= () => undefined
  pointerCaptureTarget.scrollIntoView ??= () => undefined
})

beforeEach(() => {
  jest.clearAllMocks()
  mockLists()
})

describe('run evaluation snapshot picker helpers', () => {
  it('collects distinct manifest hashes newest first and ignores labels', () => {
    expect(
      knownSnapshotHashes([
        { manifest_hash: KNOWN_HASH, eval_set_version: KNOWN_HASH },
        { manifest_hash: OLDER_HASH, eval_set_version: 'release-1' },
        { manifest_hash: null, eval_set_version: null },
      ]),
    ).toEqual([KNOWN_HASH, OLDER_HASH])
  })

  it('shortens a hash for display', () => {
    expect(shortSnapshotHash(KNOWN_HASH)).toBe('sha256:known0123456…')
    expect(shortSnapshotHash('sha256:short')).toBe('sha256:short')
  })

  it('keeps the unpinned body unchanged and omits the case list for a pinned all-cases run', () => {
    const base = { agentId: AGENT_ID, caseIds: [CASE_ID], selection: '__all__', repeatCount: 2, judgeMayGate: false }
    expect(buildEvalRunRequestBody({ ...base, snapshot: SNAPSHOT_NONE })).toEqual({
      agentDefinitionId: AGENT_ID,
      evalCaseIds: [CASE_ID],
      repeatCount: 2,
      judgeMayGate: false,
    })
    expect(buildEvalRunRequestBody({ ...base, snapshot: SNAPSHOT_LATEST })).toEqual({
      agentDefinitionId: AGENT_ID,
      snapshot: 'latest',
      repeatCount: 2,
      judgeMayGate: false,
    })
    expect(buildEvalRunRequestBody({ ...base, selection: CASE_ID, snapshot: SNAPSHOT_LATEST })).toMatchObject({
      evalCaseIds: [CASE_ID],
      snapshot: SNAPSHOT_LATEST,
    })
  })

  it('always replays the whole frozen set for a hash pin, even with a single case selected', () => {
    const body = buildEvalRunRequestBody({
      agentId: AGENT_ID,
      caseIds: [CASE_ID],
      selection: CASE_ID,
      snapshot: KNOWN_HASH,
      repeatCount: 1,
      judgeMayGate: false,
    })
    expect(body).toEqual({ agentDefinitionId: AGENT_ID, snapshot: KNOWN_HASH, repeatCount: 1, judgeMayGate: false })
  })

  it('requires live approved cases only when the run is not pinned to a hash', () => {
    expect(canSubmitEvalRun({ caseCount: 0, snapshot: SNAPSHOT_NONE })).toBe(false)
    expect(canSubmitEvalRun({ caseCount: 0, snapshot: SNAPSHOT_LATEST })).toBe(false)
    expect(canSubmitEvalRun({ caseCount: 0, snapshot: KNOWN_HASH })).toBe(true)
    expect(canSubmitEvalRun({ caseCount: 1, snapshot: SNAPSHOT_NONE })).toBe(true)
  })
})

describe('RunEvaluationDrawer snapshot picker', () => {
  it('sends no snapshot by default', async () => {
    renderDrawer()
    const form = (await screen.findByRole('combobox', { name: dict['agent_orchestrator.agentDetail.evaluation.run.snapshot'] })).closest('form')
    expect(form).not.toBeNull()

    fireEvent.keyDown(form as HTMLFormElement, { key: 'Enter', metaKey: true })

    await waitFor(() => expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1))
    expect(apiCallOrThrowMock.mock.calls[0][0]).toBe('/api/agent_orchestrator/eval-runs')
    expect(sentBody()).toEqual({ agentDefinitionId: AGENT_ID, evalCaseIds: [CASE_ID], repeatCount: 1, judgeMayGate: false })
  })

  it('sends the selected known hash as snapshot on Ctrl+Enter', async () => {
    renderDrawer()
    const trigger = await screen.findByRole('combobox', { name: dict['agent_orchestrator.agentDetail.evaluation.run.snapshot'] })
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(2))

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.click(trigger)
    expect(await screen.findByRole('option', { name: dict['agent_orchestrator.agentDetail.evaluation.run.snapshotLatest'] })).toBeTruthy()
    fireEvent.click(await screen.findByRole('option', { name: shortSnapshotHash(KNOWN_HASH) }))

    fireEvent.keyDown(trigger.closest('form') as HTMLFormElement, { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1))
    expect(sentBody()).toEqual({ agentDefinitionId: AGENT_ID, snapshot: KNOWN_HASH, repeatCount: 1, judgeMayGate: false })
  })

  it('locks the case picker to the whole frozen set once a hash snapshot is selected', async () => {
    renderDrawer()
    const trigger = await screen.findByRole('combobox', { name: dict['agent_orchestrator.agentDetail.evaluation.run.snapshot'] })
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(2))
    const caseSet = screen.getByRole('combobox', { name: dict['agent_orchestrator.agentDetail.evaluation.run.caseSet'] })
    expect(caseSet.hasAttribute('disabled')).toBe(false)

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('option', { name: shortSnapshotHash(KNOWN_HASH) }))

    await waitFor(() => expect(caseSet.hasAttribute('disabled')).toBe(true))
    expect(caseSet.textContent).toBe(dict['agent_orchestrator.agentDetail.evaluation.run.allInSnapshot'])
  })

  it('replays a hash pin with zero live approved cases', async () => {
    mockLists([])
    renderDrawer()
    const trigger = await screen.findByRole('combobox', { name: dict['agent_orchestrator.agentDetail.evaluation.run.snapshot'] })
    const submitButton = screen.getByRole('button', { name: dict['agent_orchestrator.agentDetail.evaluation.run.submit'] })
    expect(submitButton.hasAttribute('disabled')).toBe(true)
    const noApprovedMessage = dict['agent_orchestrator.agentDetail.evaluation.run.noApproved']
    expect(screen.queryByText(noApprovedMessage)).not.toBeNull()

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('option', { name: shortSnapshotHash(KNOWN_HASH) }))

    await waitFor(() => expect(submitButton.hasAttribute('disabled')).toBe(false))
    expect(screen.queryByText(noApprovedMessage)).toBeNull()
    fireEvent.keyDown(trigger.closest('form') as HTMLFormElement, { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1))
    expect(sentBody()).toEqual({ agentDefinitionId: AGENT_ID, snapshot: KNOWN_HASH, repeatCount: 1, judgeMayGate: false })
  })
})
