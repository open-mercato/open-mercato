/**
 * @jest-environment jsdom
 *
 * The external-run card as an operator sees it (tracker task 3.4).
 *
 * Four properties are load-bearing:
 * - a run with a correlation row shows its STATUS, the PROVIDER's run id and the
 *   two clocks, which is everything that made an external run illegible before;
 * - a run without one renders NOTHING, so a native trace is untouched and a
 *   failed read never shows a broken card;
 * - the recording control appears only when the connector can actually serve it,
 *   and the card always says where the recording lives;
 * - every user-facing string comes from the locale files, in all five locales.
 */

import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import en from '../i18n/en.json'
import de from '../i18n/de.json'
import es from '../i18n/es.json'
import pl from '../i18n/pl.json'
import ko from '../i18n/ko.json'
import { ExternalRunCard } from '../components/ExternalRunPanel'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, status: 200, result: {}, response: {}, cacheStatus: null })),
  apiCallOrThrow: jest.fn(async () => ({})),
  readApiResultOrThrow: jest.fn(async () => ({})),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

const dict = en as Record<string, string>
const RUN_ID = '55555555-5555-4555-8555-555555555555'
const CONVERSATION_ID = 'conv_abc123'

const RUN_CLOCK = {
  createdAt: '2026-08-13T10:00:00.000Z',
  completedAt: '2026-08-13T10:28:00.000Z',
  latencyMs: 74_000,
}

function mockExternalState(result: unknown, ok = true) {
  ;(apiCall as jest.Mock).mockResolvedValue({ ok, status: ok ? 200 : 500, result, response: {}, cacheStatus: null })
}

function externalRunPayload(overrides: Record<string, unknown> = {}) {
  return {
    externalRun: {
      id: 'ext-1',
      connectorId: 'elevenlabs.voice',
      status: 'completed',
      externalRunId: CONVERSATION_ID,
      expiresAt: '2026-08-13T10:30:00.000Z',
      createdAt: '2026-08-13T10:00:00.000Z',
      updatedAt: '2026-08-13T10:28:00.000Z',
      processId: '33333333-3333-4333-8333-333333333333',
      stepId: 'call-owner',
      signalName: 'agent_orchestrator.proposal.ready',
      ...overrides,
    },
    connector: { id: 'elevenlabs.voice', registered: true, supportsRecording: true },
  }
}

beforeEach(() => jest.clearAllMocks())

describe('ExternalRunCard', () => {
  it('renders the external state: status, provider run id and the parked-vs-talked pair', async () => {
    mockExternalState(externalRunPayload())
    renderWithProviders(<ExternalRunCard runId={RUN_ID} run={RUN_CLOCK} />, { dict })

    expect(await screen.findByText(dict['agent_orchestrator.traces.detail.external.title'])).toBeTruthy()
    expect(screen.getByText(dict['agent_orchestrator.traces.detail.external.status.completed'])).toBeTruthy()
    expect(screen.getByText('elevenlabs.voice')).toBeTruthy()
    expect(screen.getByText(CONVERSATION_ID)).toBeTruthy()
    expect(screen.getByText('call-owner')).toBeTruthy()

    // The pair, and it is a PAIR: both labels present, and the two durations are
    // different quantities rendered side by side rather than one standing in for
    // the other. 28 minutes parked, 74 seconds of provider work.
    expect(screen.getByText(dict['agent_orchestrator.traces.detail.external.parked'])).toBeTruthy()
    expect(screen.getByText(dict['agent_orchestrator.traces.detail.external.talked'])).toBeTruthy()
    expect(screen.getByText('28m')).toBeTruthy()
    expect(screen.getByText('74.0s')).toBeTruthy()
  })

  it('shows a still-pending run its deadline, and hides that deadline once settled', async () => {
    mockExternalState(externalRunPayload({ status: 'pending' }))
    const { unmount } = renderWithProviders(<ExternalRunCard runId={RUN_ID} run={RUN_CLOCK} />, { dict })
    expect(await screen.findByText(dict['agent_orchestrator.traces.detail.external.deadline'])).toBeTruthy()
    unmount()

    mockExternalState(externalRunPayload({ status: 'completed' }))
    renderWithProviders(<ExternalRunCard runId={RUN_ID} run={RUN_CLOCK} />, { dict })
    await screen.findByText(dict['agent_orchestrator.traces.detail.external.title'])
    expect(screen.queryByText(dict['agent_orchestrator.traces.detail.external.deadline'])).toBeNull()
  })

  it('degrades to nothing when the run has no correlation row', async () => {
    mockExternalState({ externalRun: null, connector: null })
    const { container } = renderWithProviders(<ExternalRunCard runId={RUN_ID} run={RUN_CLOCK} />, { dict })

    await waitFor(() => expect(apiCall).toHaveBeenCalled())
    expect(container.querySelector('section')).toBeNull()
    expect(screen.queryByText(dict['agent_orchestrator.traces.detail.external.title'])).toBeNull()
  })

  it('degrades to nothing when the read fails, rather than showing a broken card', async () => {
    mockExternalState({ error: 'boom' }, false)
    const { container } = renderWithProviders(<ExternalRunCard runId={RUN_ID} run={RUN_CLOCK} />, { dict })

    await waitFor(() => expect(apiCall).toHaveBeenCalled())
    expect(container.querySelector('section')).toBeNull()
  })

  it('offers the recording control only when the connector supports it, and always says where the file lives', async () => {
    mockExternalState(externalRunPayload())
    const { unmount } = renderWithProviders(<ExternalRunCard runId={RUN_ID} run={RUN_CLOCK} />, { dict })

    const link = await screen.findByText(dict['agent_orchestrator.traces.detail.external.recordingFetch'])
    expect(link.closest('a')?.getAttribute('href')).toBe(
      `/api/agent_orchestrator/runs/${RUN_ID}/recording`,
    )
    // The controllership sentence is not optional chrome — an operator who does
    // not know the recording lives at the provider cannot answer an erasure
    // request about it.
    expect(screen.getByText(dict['agent_orchestrator.traces.detail.external.recordingNote'])).toBeTruthy()
    unmount()

    mockExternalState({
      ...externalRunPayload(),
      connector: { id: 'elevenlabs.voice', registered: true, supportsRecording: false },
    })
    renderWithProviders(<ExternalRunCard runId={RUN_ID} run={RUN_CLOCK} />, { dict })
    await screen.findByText(dict['agent_orchestrator.traces.detail.external.recordingUnsupported'])
    expect(screen.queryByText(dict['agent_orchestrator.traces.detail.external.recordingFetch'])).toBeNull()
  })

  it('explains an undeployed connector instead of silently dropping the control', async () => {
    mockExternalState({
      ...externalRunPayload(),
      connector: { id: 'elevenlabs.voice', registered: false, supportsRecording: false },
    })
    renderWithProviders(<ExternalRunCard runId={RUN_ID} run={RUN_CLOCK} />, { dict })

    expect(
      await screen.findByText(dict['agent_orchestrator.traces.detail.external.connectorMissing']),
    ).toBeTruthy()
  })

  it('names an unreported provider run id rather than rendering a blank cell', async () => {
    mockExternalState({
      externalRun: { ...externalRunPayload().externalRun, externalRunId: null },
      connector: { id: 'elevenlabs.voice', registered: true, supportsRecording: true },
    })
    renderWithProviders(<ExternalRunCard runId={RUN_ID} run={RUN_CLOCK} />, { dict })

    expect(
      await screen.findByText(dict['agent_orchestrator.traces.detail.external.providerRunIdUnknown']),
    ).toBeTruthy()
    // No provider id means nothing to fetch, so the control must not be offered.
    expect(screen.queryByText(dict['agent_orchestrator.traces.detail.external.recordingFetch'])).toBeNull()
  })
})

describe('i18n coverage of the task-3.4 surfaces', () => {
  const MODULE_ROOT = join(__dirname, '..')
  const TOUCHED_FILES = [
    'components/ExternalRunPanel.tsx',
    'backend/traces/[id]/page.tsx',
    'backend/playground/page.tsx',
  ]

  const LOCALES: Array<[string, Record<string, string>]> = [
    ['en', en as Record<string, string>],
    ['de', de as Record<string, string>],
    ['es', es as Record<string, string>],
    ['pl', pl as Record<string, string>],
    ['ko', ko as Record<string, string>],
  ]

  /** Every `t('key'…)` in a file, whether or not it supplies an English default. */
  function translationKeys(relativePath: string): string[] {
    const source = readFileSync(join(MODULE_ROOT, relativePath), 'utf8')
    return [...source.matchAll(/\bt\(\s*'([a-z_][\w.]*)'/gi)].map((match) => match[1])
  }

  const NEW_KEY_PREFIXES = [
    'agent_orchestrator.traces.detail.external.',
    'agent_orchestrator.traces.detail.rerunExternal.',
    'agent_orchestrator.traces.detail.actionRerun',
    'agent_orchestrator.playground.suspended.',
  ]

  it.each(LOCALES)('%s defines every key the new surfaces use', (_name, locale) => {
    const missing = TOUCHED_FILES.flatMap(translationKeys)
      .filter((key) => NEW_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)))
      .filter((key) => !(key in locale))
    expect(missing).toEqual([])
  })

  it('carries the same key set in all five locales — none may lag', () => {
    const enKeys = Object.keys(en as Record<string, string>).filter((key) =>
      NEW_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
    )
    expect(enKeys.length).toBeGreaterThan(0)
    for (const [name, locale] of LOCALES) {
      expect([name, enKeys.filter((key) => !(key in locale))]).toEqual([name, []])
    }
  })

  it('renders no hardcoded user-facing string in the external-run card', () => {
    const source = readFileSync(join(MODULE_ROOT, 'components/ExternalRunPanel.tsx'), 'utf8')
    // Any bare JSX text node of two or more words would be untranslatable copy.
    // Attributes, class names and code are excluded by construction: this only
    // looks between a `>` and a `<`.
    const jsxText = [...source.matchAll(/>\s*([A-Za-z][A-Za-z' ]{6,})\s*</g)].map((match) =>
      match[1].trim(),
    )
    expect(jsxText).toEqual([])
  })
})
