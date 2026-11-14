/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const SHARED_PROJECT_ID = '11111111-1111-1111-1111-111111111111'
const LEGACY_PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const UNASSIGNED_PROJECT_ID = '44444444-4444-4444-4444-444444444444'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

let preferenceResponse: { lastProjectId: string | null; updatedAt: string | null }
let preferenceGate: Deferred<void> | null
let preferenceFetchFails = false
let selfLookupFails = false
let selfLookupHasNoMember = false
const savedPreferences: Array<string | null> = []

const mockApiCall = jest.fn(async (url: string, init?: { method?: string; body?: string }) => {
  if (url.includes('/api/staff/timesheets/my-preferences')) {
    if (init?.method === 'PUT') {
      savedPreferences.push(JSON.parse(init.body ?? '{}').lastProjectId ?? null)
      return { ok: true, status: 200, result: preferenceResponse }
    }
    if (preferenceGate) await preferenceGate.promise
    if (preferenceFetchFails) return { ok: false, status: 500, result: { error: 'boom' } }
    return { ok: true, status: 200, result: preferenceResponse }
  }
  if (url.includes('/api/staff/team-members/self')) {
    // Drives the active-timer query into its error state: the hook resolves the
    // member through this call and throws when it is not ok.
    if (selfLookupFails) return { ok: false, status: 500, result: { error: 'boom' } }
    // A successful lookup that resolves no member: the query settles without an
    // error and `staffMemberId` stays null, which is a different state from the
    // failure above and must not be conflated with it.
    if (selfLookupHasNoMember) return { ok: true, status: 200, result: { member: null } }
    return { ok: true, status: 200, result: { member: { id: MEMBER_ID } } }
  }
  if (url.includes('/api/staff/timesheets/time-entries')) {
    return { ok: true, status: 200, result: { items: [] } }
  }
  return { ok: true, status: 200, result: {} }
})

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (_key: string, fallback?: string) => fallback ?? _key
  return { useT: () => translate }
})

const startTimerEntry = jest.fn()
jest.mock('../../../../lib/timesheets-ui/startTimer', () => ({
  startTimerEntry: (...args: unknown[]) => startTimerEntry(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: [string, { method?: string; body?: string }?]) => mockApiCall(...args),
  readApiResultOrThrow: jest.fn(async (url: string) => {
    if (url.includes('/api/staff/timesheets/my-projects')) {
      return { items: [{ time_project_id: SHARED_PROJECT_ID }, { time_project_id: LEGACY_PROJECT_ID }] }
    }
    if (url.includes('/api/staff/timesheets/time-projects')) {
      return {
        items: [
          { id: SHARED_PROJECT_ID, name: 'Acme', code: null },
          { id: LEGACY_PROJECT_ID, name: 'Globex', code: null },
        ],
      }
    }
    if (url.includes('/api/staff/team-members/self')) {
      return { member: { id: MEMBER_ID } }
    }
    return { items: [] }
  }),
}))

import TimeReportingWidget from '../widget.client'

function renderWidget(settings: { lastProjectId: string | null }, onSettingsChange = jest.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <TimeReportingWidget
        mode={'view' as never}
        settings={settings as never}
        onSettingsChange={onSettingsChange}
        refreshToken={0}
        onRefreshStateChange={jest.fn()}
      />
    </QueryClientProvider>,
  )
  return { ...utils, onSettingsChange }
}

const findProjectSelect = async () => (await screen.findByLabelText('Project')) as HTMLSelectElement

describe('TimeReportingWidget shared-preference seeding (#3750 Phase 3)', () => {
  beforeEach(() => {
    startTimerEntry.mockReset()
    startTimerEntry.mockResolvedValue({ id: 'entry-1' })
    mockApiCall.mockClear()
    savedPreferences.length = 0
    preferenceGate = null
    preferenceFetchFails = false
    selfLookupFails = false
    selfLookupHasNoMember = false
    preferenceResponse = { lastProjectId: null, updatedAt: null }
  })

  it('does not latch onto the legacy value when the active-timer lookup fails first', async () => {
    // The member id is resolved by the active-timer query, so a failed lookup
    // leaves it null while the query is no longer loading. Seeding there would
    // skip the preference wait, latch the once-per-mount ref on the deprecated
    // per-widget value, and lock the shared preference out for the whole
    // session once the query recovers — a silent precedence inversion that
    // feeds the spec's "accidental start on a stale default" risk.
    selfLookupFails = true
    preferenceResponse = { lastProjectId: SHARED_PROJECT_ID, updatedAt: null }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    })
    const renderWith = (refreshToken: number) => (
      <QueryClientProvider client={queryClient}>
        <TimeReportingWidget
          mode={'view' as never}
          settings={{ lastProjectId: LEGACY_PROJECT_ID } as never}
          onSettingsChange={jest.fn()}
          refreshToken={refreshToken}
          onRefreshStateChange={jest.fn()}
        />
      </QueryClientProvider>
    )
    const { rerender } = render(renderWith(0))

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())

    // Recovery, as the refetch interval would produce in the real widget.
    selfLookupFails = false
    rerender(renderWith(1))

    const select = await findProjectSelect()
    await waitFor(() => expect(select.value).toBe(SHARED_PROJECT_ID))
  })

  it('seeds the picker from the shared preference', async () => {
    preferenceResponse = { lastProjectId: SHARED_PROJECT_ID, updatedAt: '2026-08-09T10:00:00.000Z' }

    renderWidget({ lastProjectId: null })

    const select = await findProjectSelect()
    await waitFor(() => expect(select.value).toBe(SHARED_PROJECT_ID))
  })

  it('falls back to the legacy widget setting when the shared preference is null', async () => {
    // TC-STAFF-039 at component level: a member whose only memory predates the
    // shared store still gets it seeded.
    renderWidget({ lastProjectId: LEGACY_PROJECT_ID })

    const select = await findProjectSelect()
    await waitFor(() => expect(select.value).toBe(LEGACY_PROJECT_ID))
  })

  it('prefers the shared preference over the legacy setting', async () => {
    preferenceResponse = { lastProjectId: SHARED_PROJECT_ID, updatedAt: '2026-08-09T10:00:00.000Z' }

    renderWidget({ lastProjectId: LEGACY_PROJECT_ID })

    const select = await findProjectSelect()
    await waitFor(() => expect(select.value).toBe(SHARED_PROJECT_ID))
    expect(select.value).not.toBe(LEGACY_PROJECT_ID)
  })

  it('waits for the shared preference rather than latching onto the legacy value first', async () => {
    // Precedence inversion guard. The seed runs once per mount, so if it fired
    // on the legacy value while the shared preference was still in flight, the
    // shared store could never win — silently reversing the documented
    // precedence (shared → legacy → null).
    preferenceGate = defer<void>()
    preferenceResponse = { lastProjectId: SHARED_PROJECT_ID, updatedAt: null }

    renderWidget({ lastProjectId: LEGACY_PROJECT_ID })

    const select = await findProjectSelect()
    // Still in flight: nothing may be seeded yet.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(select.value).toBe('')

    preferenceGate.resolve()

    await waitFor(() => expect(select.value).toBe(SHARED_PROJECT_ID))
  })

  it('does not seed the legacy value when the preference fetch failed', async () => {
    // The guard the TimerBar already applies (`TimerBar.seeding.test.tsx` —
    // "does not seed a lower rung when the preference fetch failed"), carried to
    // this surface. A failed fetch settles with `lastProjectId: null`, so without
    // the guard the effect falls through to the legacy value and latches it for
    // the rest of the mount, even once the query recovers.
    //
    // It matters more here than the symmetry suggests: the TimerBar writes only
    // the shared store, so a member who starts timers from the timesheets page
    // has a legacy value that is legitimately stale. Preselecting it invites a
    // start on the wrong project — the harm `resolveSeedProjectId`'s ambiguity
    // rule exists to prevent. No seed is the honest state; it costs one click.
    preferenceFetchFails = true

    renderWidget({ lastProjectId: LEGACY_PROJECT_ID })

    const select = await findProjectSelect()
    await waitFor(() => expect(select).toBeEnabled())
    expect(select.value).toBe('')
  })

  it('still seeds from the legacy value when there is no staff member at all', async () => {
    // The counterpart to the guard above: with no member id the preference query
    // is disabled and never errors, so the legacy setting remains the only memory
    // available and must still be honoured. Pinning this keeps the new guard from
    // being widened into `if (preferenceError) return`, which would silently drop
    // the fallback the deprecation window exists to serve.
    selfLookupHasNoMember = true

    renderWidget({ lastProjectId: LEGACY_PROJECT_ID })

    const select = await findProjectSelect()
    await waitFor(() => expect(select.value).toBe(LEGACY_PROJECT_ID))
  })

  it('ignores a remembered project the member can no longer pick', async () => {
    // An id absent from the option list would render a blank selection with an
    // enabled Start button — worse than no seed.
    preferenceResponse = { lastProjectId: UNASSIGNED_PROJECT_ID, updatedAt: null }

    renderWidget({ lastProjectId: null })

    const select = await findProjectSelect()
    await waitFor(() => expect(select).toBeEnabled())
    expect(select.value).toBe('')
  })

  it('does not overwrite a deliberate pick made before the preference resolves', async () => {
    // The race the synchronous `useState` seed used to hide: the user chooses
    // while the fetch is in flight, and the late response must lose.
    preferenceGate = defer<void>()
    preferenceResponse = { lastProjectId: SHARED_PROJECT_ID, updatedAt: null }

    renderWidget({ lastProjectId: null })

    const select = await findProjectSelect()
    fireEvent.change(select, { target: { value: LEGACY_PROJECT_ID } })
    expect(select.value).toBe(LEGACY_PROJECT_ID)

    preferenceGate.resolve()

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith(
      expect.stringContaining('/api/staff/timesheets/my-preferences'),
    ))
    // Give the seed effect every chance to run against the resolved preference.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(select.value).toBe(LEGACY_PROJECT_ID)
  })

  it('seeds at most once per mount, so clearing the picker is not undone', async () => {
    preferenceResponse = { lastProjectId: SHARED_PROJECT_ID, updatedAt: null }

    renderWidget({ lastProjectId: null })

    const select = await findProjectSelect()
    await waitFor(() => expect(select.value).toBe(SHARED_PROJECT_ID))

    fireEvent.change(select, { target: { value: '' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(select.value).toBe('')
  })

  it('writes a legacy-only memory through to the shared store on the next start', async () => {
    // TC-STAFF-039 at component level. A member whose only memory is the legacy
    // widget setting is seeded from it, and the next successful start publishes
    // that value to the shared store — so the row self-heals with no backfill
    // migration reaching into `dashboard_layouts.layout_json`.
    renderWidget({ lastProjectId: LEGACY_PROJECT_ID })

    const select = await findProjectSelect()
    await waitFor(() => expect(select.value).toBe(LEGACY_PROJECT_ID))

    fireEvent.click(screen.getByRole('button', { name: 'Start Timer' }))

    await waitFor(() => expect(savedPreferences).toEqual([LEGACY_PROJECT_ID]))
  })

  it('dual-writes the shared preference and the legacy setting on a successful start', async () => {
    renderWidget({ lastProjectId: null })

    const select = await findProjectSelect()
    fireEvent.change(select, { target: { value: LEGACY_PROJECT_ID } })
    fireEvent.click(screen.getByRole('button', { name: 'Start Timer' }))

    await waitFor(() => expect(savedPreferences).toEqual([LEGACY_PROJECT_ID]))
  })

  it('writes the legacy setting alongside the shared store for rollback safety', async () => {
    const onSettingsChange = jest.fn()
    renderWidget({ lastProjectId: null }, onSettingsChange)

    const select = await findProjectSelect()
    fireEvent.change(select, { target: { value: SHARED_PROJECT_ID } })
    fireEvent.click(screen.getByRole('button', { name: 'Start Timer' }))

    await waitFor(() =>
      expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ lastProjectId: SHARED_PROJECT_ID })),
    )
  })

  it('does not write the preference when the start itself fails', async () => {
    startTimerEntry.mockRejectedValue(Object.assign(new Error('nope'), { status: 409 }))

    renderWidget({ lastProjectId: null })

    const select = await findProjectSelect()
    fireEvent.change(select, { target: { value: SHARED_PROJECT_ID } })
    fireEvent.click(screen.getByRole('button', { name: 'Start Timer' }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(savedPreferences).toEqual([])
  })

  it('keeps the start successful when the preference write fails', async () => {
    mockApiCall.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      if (url.includes('/api/staff/timesheets/my-preferences')) {
        if (init?.method === 'PUT') return { ok: false, status: 500, result: null }
        return { ok: true, status: 200, result: preferenceResponse }
      }
      if (url.includes('/api/staff/team-members/self')) {
        return { ok: true, status: 200, result: { member: { id: MEMBER_ID } } }
      }
      return { ok: true, status: 200, result: { items: [] } }
    })

    renderWidget({ lastProjectId: null })

    const select = await findProjectSelect()
    fireEvent.change(select, { target: { value: SHARED_PROJECT_ID } })
    fireEvent.click(screen.getByRole('button', { name: 'Start Timer' }))

    await waitFor(() => expect(startTimerEntry).toHaveBeenCalled())
    // The timer is already running; a failed memory write must not surface.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
