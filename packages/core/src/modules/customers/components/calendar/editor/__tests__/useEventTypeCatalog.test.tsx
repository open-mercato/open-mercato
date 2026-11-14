/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'
import { calendarEventTypes } from '../../../../calendar-event-types'
import type { ScopedCalendarEventType } from '../../../../lib/calendar/eventTypeResolver'

const readApiResultOrThrowMock = jest.fn()
const reportErrorMock = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

import { emitOrganizationScopeChanged, type OrganizationScopeChangedDetail } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { clearScopeCookies, orgA, orgB, queueReads, writeScopeCookies } from './scopeFixtures'
import { clearEventTypeCatalogCache, eventTypeConfig, eventTypeOptions, isSelectableEventType, selectedEventType, useEventTypeCatalog } from '../useEventTypeCatalog'

function scopedType(key: string, order: number, selectable = true): ScopedCalendarEventType {
  return {
    ...calendarEventTypes[0]!,
    key,
    label: key,
    behavior: { ...calendarEventTypes[0]!.behavior, order },
    selectable,
    source: 'customers',
    provenance: {},
    historical: false,
    adminConfigurable: true,
    isInherited: false,
    isLocalOverride: false,
    updatedAt: null,
    missingCustomFieldsetIds: [],
  }
}

function switchScope(scope: OrganizationScopeChangedDetail): void {
  writeScopeCookies(scope)
  act(() => emitOrganizationScopeChanged(scope))
}

type ScopeEvents = typeof import('@open-mercato/shared/lib/frontend/organizationEvents')
type CatalogModule = typeof import('../useEventTypeCatalog')

// The scope module keeps its first-report state for the whole page, so each case loads a new
// copy after the cookies are in place, exactly as a page load does.
function loadPage(cookies: OrganizationScopeChangedDetail | null) {
  clearScopeCookies()
  if (cookies) writeScopeCookies(cookies)
  const react = jest.requireActual('react')
  let events!: ScopeEvents
  let catalog!: CatalogModule
  jest.isolateModules(() => {
    jest.doMock('react', () => react)
    events = require('@open-mercato/shared/lib/frontend/organizationEvents') as ScopeEvents
    catalog = require('../useEventTypeCatalog') as CatalogModule
  })
  return {
    useEventTypeCatalog: catalog.useEventTypeCatalog,
    version: () => events.getCurrentOrganizationScopeVersion(),
    reportOnly: (scope: OrganizationScopeChangedDetail) => { act(() => events.emitOrganizationScopeChanged(scope)) },
    switchTo: (scope: OrganizationScopeChangedDetail) => {
      writeScopeCookies(scope)
      act(() => events.emitOrganizationScopeChanged(scope))
    },
  }
}

describe('calendar editor scoped type catalog', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
    reportErrorMock.mockReset()
    clearEventTypeCatalogCache()
    clearScopeCookies()
    switchScope(orgA)
  })

  it('orders selectable types and keeps an unavailable historical selection out of later choices', () => {
    const items = [scopedType('late', 20), scopedType('early', 10), scopedType('hidden', 0, false)]
    const translate = (key: string, fallback: string) => fallback
    expect(eventTypeOptions(items, 'hidden', translate).map((option) => option.value)).toEqual(['hidden', 'early', 'late'])
    expect(eventTypeOptions(items, 'early', translate).map((option) => option.value)).toEqual(['early', 'late'])
    expect(selectedEventType(items, 'removed').historical).toBe(true)
  })

  it('uses a patched label key for the visible type and preserved historical selection', () => {
    const meeting = { ...scopedType('meeting', 0), label: 'Meeting', labelKey: 'example.calendar.customerMeeting' }
    const hidden = { ...scopedType('hidden', 1, false), label: 'Old label', labelKey: 'example.calendar.oldLabel' }
    const translate = (key: string, fallback: string) => key === 'example.calendar.customerMeeting'
      ? 'Customer meeting'
      : key === 'example.calendar.oldLabel' ? 'Previous label' : fallback
    expect(eventTypeOptions([meeting], 'meeting', translate)[0]?.label).toBe('Customer meeting')
    expect(eventTypeOptions([meeting, hidden], 'hidden', translate)[0]?.label).toBe('Previous label')
  })

  it('uses the effective field behavior for the selected type', () => {
    const definition = scopedType('visit', 10)
    const custom = {
      ...definition,
      behavior: {
        ...definition.behavior,
        fields: { ...definition.behavior.fields, recurrence: false, location: 'none' as const, resources: false },
      },
    }
    expect(eventTypeConfig(custom)).toMatchObject({ hasRepeat: false, location: null })
  })

  it('resolves mixed-case stored keys with the configured behavior and keeps their selected value', () => {
    const type = { ...scopedType('site visit', 0), label: 'Site visit', behavior: { ...calendarEventTypes[0]!.behavior, fields: { ...calendarEventTypes[0]!.behavior.fields, endTime: false, priority: true } } }
    expect(selectedEventType([type], ' Site Visit ')).toBe(type)
    expect(eventTypeConfig(selectedEventType([type], ' Site Visit '))).toMatchObject({ hasEnd: false, hasPriority: true })
    expect(eventTypeOptions([type], ' Site Visit ', (_key, fallback) => fallback)).toEqual([{ value: ' Site Visit ', label: 'Site visit', icon: type.icon }])
    expect(isSelectableEventType([type], ' Site Visit ')).toBe(true)
    expect(isSelectableEventType([{ ...type, selectable: false }], ' Site Visit ')).toBe(false)
    expect(selectedEventType([], 'Task').behavior.baseKind).toBe('task')
  })

  it('loads once per open and retries after a catalog failure', async () => {
    const error = new Error('unavailable')
    readApiResultOrThrowMock.mockRejectedValueOnce(error)
      .mockResolvedValue({ items: [scopedType('visit', 10)], fallbackKey: 'meeting' })
    const { result, rerender } = renderHook(({ open }) => useEventTypeCatalog(open), { initialProps: { open: true } })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(error, {
      module: 'customers',
      code: 'customers.activity_type_catalog_load_failed',
    })
    await act(async () => { result.current.retry() })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.items[0]?.key).toBe('visit')
    rerender({ open: false })
    await act(async () => {})
    expect(result.current.status).toBe('ready')
    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2)
    rerender({ open: true })
    await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(3))
  })
  it('warms the cache while the editor is still closed and does not refetch until it opens', async () => {
    readApiResultOrThrowMock.mockResolvedValue({ items: [scopedType('visit', 10)], fallbackKey: 'meeting' })
    const { result, rerender } = renderHook(({ open }) => useEventTypeCatalog(open), { initialProps: { open: false } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(1)
    rerender({ open: false })
    await act(async () => {})
    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(1)
    rerender({ open: true })
    expect(result.current.status).toBe('ready')
    await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2))
  })

  it('reopens from the cached catalog and revalidates without re-rendering an unchanged catalog', async () => {
    const visit = scopedType('visit', 10)
    readApiResultOrThrowMock.mockResolvedValue({ items: [visit], fallbackKey: 'meeting' })
    const first = renderHook(({ open }) => useEventTypeCatalog(open), { initialProps: { open: true } })
    expect(first.result.current.status).toBe('loading')
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    first.unmount()

    const renders: string[] = []
    const second = renderHook(({ open }) => {
      const catalog = useEventTypeCatalog(open)
      renders.push(catalog.status)
      return catalog
    }, { initialProps: { open: true } })
    expect(second.result.current.status).toBe('ready')
    expect(second.result.current.items[0]?.key).toBe('visit')
    await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(renders.every((status) => status === 'ready')).toBe(true)
    expect(renders.length).toBe(1)

    readApiResultOrThrowMock.mockResolvedValue({ items: [visit, scopedType('call', 20)], fallbackKey: 'meeting' })
    const third = renderHook(({ open }) => useEventTypeCatalog(open), { initialProps: { open: true } })
    expect(third.result.current.items.map((item) => item.key)).toEqual(['visit'])
    await waitFor(() => expect(third.result.current.items.map((item) => item.key)).toEqual(['visit', 'call']))
    expect(third.result.current.status).toBe('ready')
  })

  describe('organization scope isolation', () => {
    it('never serves the previous organization catalog after a switch', async () => {
      readApiResultOrThrowMock.mockResolvedValueOnce({ items: [scopedType('org-a-type', 1)] })
      const { result } = renderHook(() => useEventTypeCatalog(true))
      await waitFor(() => expect(result.current.status).toBe('ready'))
      expect(result.current.items.map((item) => item.key)).toEqual(['org-a-type'])

      let resolveB: (value: unknown) => void = () => {}
      readApiResultOrThrowMock.mockReturnValueOnce(new Promise((resolve) => { resolveB = resolve }))
      switchScope(orgB)

      expect(result.current.status).toBe('loading')
      expect(result.current.items).toEqual([])

      await act(async () => { resolveB({ items: [scopedType('org-b-type', 1)] }) })
      await waitFor(() => expect(result.current.items.map((item) => item.key)).toEqual(['org-b-type']))
    })

    it('discards a response that was in flight when the organization changed', async () => {
      let resolveA: (value: unknown) => void = () => {}
      readApiResultOrThrowMock.mockReturnValueOnce(new Promise((resolve) => { resolveA = resolve }))
      const { result } = renderHook(() => useEventTypeCatalog(true))

      readApiResultOrThrowMock.mockResolvedValueOnce({ items: [scopedType('org-b-type', 1)] })
      switchScope(orgB)
      await waitFor(() => expect(result.current.items.map((item) => item.key)).toEqual(['org-b-type']))

      await act(async () => { resolveA({ items: [scopedType('org-a-late', 1)] }) })
      expect(result.current.items.map((item) => item.key)).toEqual(['org-b-type'])

      readApiResultOrThrowMock.mockReturnValueOnce(new Promise(() => {}))
      switchScope(orgA)
      expect(result.current.status).toBe('loading')
      expect(result.current.items).toEqual([])
    })

    it('reports an error instead of the old catalog when the new organization fails to load', async () => {
      readApiResultOrThrowMock.mockResolvedValueOnce({ items: [scopedType('org-a-type', 1)] })
      const { result } = renderHook(() => useEventTypeCatalog(true))
      await waitFor(() => expect(result.current.status).toBe('ready'))

      readApiResultOrThrowMock.mockRejectedValueOnce(new Error('boom'))
      switchScope(orgB)
      await waitFor(() => expect(result.current.status).toBe('error'))
      expect(result.current.items).toEqual([])
    })
  })

  describe('on a page load, before and after the switcher reports the scope', () => {
    const typeA = scopedType('org-a-type', 1)
    const typeB = scopedType('org-b-type', 1)
    const keys = (items: readonly ScopedCalendarEventType[]) => items.map((item) => item.key)

    it('keeps the form mounted and does not refetch when the report names the scope the read went out under', async () => {
      const page = loadPage(orgA)
      readApiResultOrThrowMock.mockResolvedValue({ items: [typeA] })
      const statuses: string[] = []
      const { result } = renderHook(() => {
        const catalog = page.useEventTypeCatalog(true)
        statuses.push(catalog.status)
        return catalog
      })
      await waitFor(() => expect(result.current.status).toBe('ready'))
      const loaded = result.current.items
      statuses.length = 0

      page.reportOnly(orgA)
      await act(async () => {})

      expect(page.version()).toBe(0)
      expect(statuses).not.toContain('loading')
      expect(result.current.status).toBe('ready')
      expect(result.current.items).toBe(loaded)
    })

    it('keeps the form mounted when an all-organizations selection is reported', async () => {
      const allOrganizations = { tenantId: 'tenant-1', organizationId: null }
      const page = loadPage(allOrganizations)
      readApiResultOrThrowMock.mockResolvedValue({ items: [typeA] })
      const statuses: string[] = []
      const { result } = renderHook(() => {
        const catalog = page.useEventTypeCatalog(true)
        statuses.push(catalog.status)
        return catalog
      })
      await waitFor(() => expect(result.current.status).toBe('ready'))
      statuses.length = 0

      page.reportOnly(allOrganizations)
      await act(async () => {})

      expect(statuses).not.toContain('loading')
      expect(result.current.status).toBe('ready')
    })

    it('does not give the next organization a late answer when the first report left the version unchanged', async () => {
      const page = loadPage(orgA)
      const pending = queueReads(readApiResultOrThrowMock)
      const { result } = renderHook(() => page.useEventTypeCatalog(true))

      page.reportOnly(orgA)
      expect(page.version()).toBe(0)
      const earlyReads = [...pending].reverse()
      pending.length = 0
      await act(async () => { earlyReads.forEach((read) => read.resolve({ items: [typeA] })) })
      expect(keys(result.current.items)).toEqual(['org-a-type'])

      page.switchTo(orgB)
      expect(page.version()).toBe(1)
      expect(result.current.status).toBe('loading')
      expect(result.current.items).toEqual([])

      await act(async () => { pending.forEach((read) => read.resolve({ items: [typeB] })) })
      expect(keys(result.current.items)).toEqual(['org-b-type'])
    })

    it('does not give the next organization an entry loaded before the editor unmounted', async () => {
      const page = loadPage(orgA)
      readApiResultOrThrowMock.mockResolvedValueOnce({ items: [typeA] })
      const first = renderHook(() => page.useEventTypeCatalog(true))
      await waitFor(() => expect(first.result.current.status).toBe('ready'))
      first.unmount()

      page.reportOnly(orgA)
      page.switchTo(orgB)

      readApiResultOrThrowMock.mockReturnValueOnce(new Promise(() => {}))
      const second = renderHook(() => page.useEventTypeCatalog(true))
      expect(second.result.current.status).toBe('loading')
      expect(second.result.current.items).toEqual([])
    })

    it('does not give the next organization an answer that arrived after the editor unmounted', async () => {
      const page = loadPage(orgA)
      const pending = queueReads(readApiResultOrThrowMock)
      const first = renderHook(() => page.useEventTypeCatalog(true))
      first.unmount()

      page.reportOnly(orgA)
      await act(async () => { pending.forEach((read) => read.resolve({ items: [typeA] })) })
      page.switchTo(orgB)

      const second = renderHook(() => page.useEventTypeCatalog(true))
      expect(second.result.current.status).toBe('loading')
      expect(second.result.current.items).toEqual([])
    })

    it('does not reuse a read made before any scope cookie existed', async () => {
      const page = loadPage(null)
      readApiResultOrThrowMock.mockResolvedValueOnce({ items: [typeA] })
      const { result } = renderHook(() => page.useEventTypeCatalog(true))
      await waitFor(() => expect(result.current.status).toBe('ready'))

      readApiResultOrThrowMock.mockReturnValueOnce(new Promise(() => {}))
      page.switchTo(orgA)

      expect(result.current.status).toBe('loading')
      expect(result.current.items).toEqual([])
    })

    it('reports an error when the first read under a named scope fails after a read without one', async () => {
      const page = loadPage(null)
      readApiResultOrThrowMock.mockResolvedValueOnce({ items: [typeA] })
      const { result } = renderHook(() => page.useEventTypeCatalog(true))
      await waitFor(() => expect(result.current.status).toBe('ready'))

      readApiResultOrThrowMock.mockRejectedValueOnce(new Error('offline'))
      page.switchTo(orgA)

      await waitFor(() => expect(result.current.status).toBe('error'))
      expect(result.current.items).toEqual([])
    })

    it('does not serve the persisted scope when the report names another one', async () => {
      const page = loadPage(orgA)
      readApiResultOrThrowMock.mockResolvedValueOnce({ items: [typeA] })
      const { result } = renderHook(() => page.useEventTypeCatalog(true))
      await waitFor(() => expect(result.current.status).toBe('ready'))

      readApiResultOrThrowMock.mockReturnValueOnce(new Promise(() => {}))
      page.switchTo(orgB)

      expect(result.current.status).toBe('loading')
      expect(result.current.items).toEqual([])
    })
  })

  describe('when a refresh of a confirmed catalog is rejected', () => {
    const visit = scopedType('visit', 10)

    async function reopenWithPendingRead() {
      readApiResultOrThrowMock.mockResolvedValueOnce({ items: [visit] })
      const view = renderHook(({ open }) => useEventTypeCatalog(open), { initialProps: { open: true } })
      await waitFor(() => expect(view.result.current.status).toBe('ready'))
      view.rerender({ open: false })
      await act(async () => {})
      const pending = queueReads(readApiResultOrThrowMock)
      view.rerender({ open: true })
      expect(view.result.current.status).toBe('ready')
      return { ...view, pending }
    }

    it('fails closed, keeps the items for the open draft and recovers only on a successful retry', async () => {
      const { result, pending } = await reopenWithPendingRead()
      const error = Object.assign(new Error('forbidden'), { status: 403 })
      await act(async () => { pending.shift()?.reject(error) })

      expect(result.current.status).toBe('stale')
      expect(result.current.items).toEqual([visit])
      expect(reportErrorMock).toHaveBeenCalledWith(error, {
        module: 'customers',
        code: 'customers.activity_type_catalog_load_failed',
      })

      await act(async () => { result.current.retry() })
      expect(result.current.status).toBe('stale')
      await act(async () => { pending.shift()?.reject(new Error('offline')) })
      expect(result.current.status).toBe('stale')
      expect(result.current.items).toEqual([visit])

      await act(async () => { result.current.retry() })
      expect(result.current.status).toBe('stale')
      await act(async () => { pending.shift()?.resolve({ items: [visit, scopedType('call', 20)] }) })
      expect(result.current.status).toBe('ready')
      expect(result.current.items.map((item) => item.key)).toEqual(['visit', 'call'])
    })

    it('does not start a later editor from the catalog that failed to refresh', async () => {
      const { result, pending, unmount } = await reopenWithPendingRead()
      await act(async () => { pending.shift()?.reject(new Error('offline')) })
      expect(result.current.status).toBe('stale')
      unmount()

      const next = renderHook(() => useEventTypeCatalog(true))
      expect(next.result.current.status).toBe('loading')
      expect(next.result.current.items).toEqual([])
    })

    it('never carries the kept items into another organization', async () => {
      const { result, pending } = await reopenWithPendingRead()
      await act(async () => { pending.shift()?.reject(new Error('offline')) })
      expect(result.current.status).toBe('stale')

      switchScope(orgB)

      expect(result.current.status).toBe('loading')
      expect(result.current.items).toEqual([])
    })
  })
})
