/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'

const fetchCustomFieldFormStructureMock = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/customFieldForms', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/customFieldForms'),
  fetchCustomFieldFormStructure: (...args: unknown[]) => fetchCustomFieldFormStructureMock(...args),
}))

import { emitOrganizationScopeChanged, type OrganizationScopeChangedDetail } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { clearScopeCookies, orgA, orgB, queueReads, writeScopeCookies } from './scopeFixtures'
import { clearCalendarCustomFieldsCache, useCalendarCustomFields } from '../useCalendarCustomFields'

const NO_FIELDSETS: readonly string[] = []
const notes = { key: 'visit_notes', kind: 'text', label: 'Visit notes' }
const entityId = 'customers:customer_interaction'

function switchScope(scope: OrganizationScopeChangedDetail): void {
  writeScopeCookies(scope)
  act(() => emitOrganizationScopeChanged(scope))
}

type ScopeEvents = typeof import('@open-mercato/shared/lib/frontend/organizationEvents')
type CustomFieldsModule = typeof import('../useCalendarCustomFields')

// The scope module keeps its first-report state for the whole page, so each case loads a new
// copy after the cookies are in place, exactly as a page load does.
function loadPage(cookies: OrganizationScopeChangedDetail | null) {
  clearScopeCookies()
  if (cookies) writeScopeCookies(cookies)
  const react = jest.requireActual('react')
  let events!: ScopeEvents
  let customFields!: CustomFieldsModule
  jest.isolateModules(() => {
    jest.doMock('react', () => react)
    events = require('@open-mercato/shared/lib/frontend/organizationEvents') as ScopeEvents
    customFields = require('../useCalendarCustomFields') as CustomFieldsModule
  })
  return {
    useCalendarCustomFields: customFields.useCalendarCustomFields,
    version: () => events.getCurrentOrganizationScopeVersion(),
    reportOnly: (scope: OrganizationScopeChangedDetail) => { act(() => events.emitOrganizationScopeChanged(scope)) },
    switchTo: (scope: OrganizationScopeChangedDetail) => {
      writeScopeCookies(scope)
      act(() => events.emitOrganizationScopeChanged(scope))
    },
  }
}

describe('useCalendarCustomFields', () => {
  beforeEach(() => {
    fetchCustomFieldFormStructureMock.mockReset()
    clearCalendarCustomFieldsCache()
    clearScopeCookies()
    switchScope(orgA)
  })

  it('loads the structure on open and serves later opens from the cache while revalidating', async () => {
    fetchCustomFieldFormStructureMock.mockResolvedValue({ definitions: [notes] })
    const first = renderHook(() => useCalendarCustomFields(true, entityId, NO_FIELDSETS))
    expect(first.result.current.status).toBe('loading')
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    expect(first.result.current.fields.map((field) => field.id)).toEqual(['cf_visit_notes'])
    first.unmount()

    const second = renderHook(() => useCalendarCustomFields(true, entityId, NO_FIELDSETS))
    expect(second.result.current.status).toBe('ready')
    expect(second.result.current.fields.map((field) => field.id)).toEqual(['cf_visit_notes'])
    await waitFor(() => expect(fetchCustomFieldFormStructureMock).toHaveBeenCalledTimes(2))
    await act(async () => {})

    const other = renderHook(() => useCalendarCustomFields(true, 'customers:other_entity', NO_FIELDSETS))
    expect(other.result.current.status).toBe('loading')
    await waitFor(() => expect(other.result.current.status).toBe('ready'))
  })

  it('warms the cache for a closed editor and revalidates on open', async () => {
    fetchCustomFieldFormStructureMock.mockResolvedValue({ definitions: [notes] })
    const { result, rerender } = renderHook(({ open }) => useCalendarCustomFields(open, 'customers:customer_interaction', NO_FIELDSETS), { initialProps: { open: false } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(fetchCustomFieldFormStructureMock).toHaveBeenCalledTimes(1)
    rerender({ open: true })
    expect(result.current.status).toBe('ready')
    await waitFor(() => expect(fetchCustomFieldFormStructureMock).toHaveBeenCalledTimes(2))
  })

  it('reports a failed load without a cached structure', async () => {
    fetchCustomFieldFormStructureMock.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useCalendarCustomFields(true, entityId, NO_FIELDSETS))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.fields).toEqual([])
  })

  it('keeps definitions apart per organization and drops a response from the previous one', async () => {
    fetchCustomFieldFormStructureMock.mockResolvedValueOnce({ definitions: [notes] })
    const { result } = renderHook(() => useCalendarCustomFields(true, entityId, NO_FIELDSETS))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.allDefinitions).toHaveLength(1)

    let resolveLate: (value: unknown) => void = () => {}
    fetchCustomFieldFormStructureMock.mockReturnValueOnce(new Promise((resolve) => { resolveLate = resolve }))
    switchScope(orgB)
    expect(result.current.status).toBe('loading')
    expect(result.current.allDefinitions).toEqual([])

    fetchCustomFieldFormStructureMock.mockResolvedValueOnce({ definitions: [] })
    switchScope({ tenantId: 'tenant-1', organizationId: 'org-c' })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => { resolveLate({ definitions: [notes] }) })
    expect(result.current.allDefinitions).toEqual([])
  })

  describe('on a page load, before and after the switcher reports the scope', () => {
    it('keeps the form mounted and does not refetch when the report names the scope the read went out under', async () => {
      const page = loadPage(orgA)
      fetchCustomFieldFormStructureMock.mockResolvedValue({ definitions: [notes] })
      const statuses: string[] = []
      const { result } = renderHook(() => {
        const customFields = page.useCalendarCustomFields(true, entityId, NO_FIELDSETS)
        statuses.push(customFields.status)
        return customFields
      })
      await waitFor(() => expect(result.current.status).toBe('ready'))
      statuses.length = 0

      page.reportOnly(orgA)
      await act(async () => {})

      expect(page.version()).toBe(0)
      expect(statuses).not.toContain('loading')
      expect(result.current.fields.map((field) => field.id)).toEqual(['cf_visit_notes'])
    })

    it('does not give the next organization a late answer when the first report left the version unchanged', async () => {
      const page = loadPage(orgA)
      const pending = queueReads(fetchCustomFieldFormStructureMock)
      const { result } = renderHook(() => page.useCalendarCustomFields(true, entityId, NO_FIELDSETS))

      page.reportOnly(orgA)
      expect(page.version()).toBe(0)
      const earlyReads = [...pending].reverse()
      pending.length = 0
      await act(async () => { earlyReads.forEach((read) => read.resolve({ definitions: [notes] })) })
      expect(result.current.allDefinitions).toHaveLength(1)

      page.switchTo(orgB)
      expect(page.version()).toBe(1)
      expect(result.current.status).toBe('loading')
      expect(result.current.allDefinitions).toEqual([])

      await act(async () => { pending.forEach((read) => read.resolve({ definitions: [] })) })
      expect(result.current.status).toBe('ready')
      expect(result.current.allDefinitions).toEqual([])
    })

    it('does not give the next organization an entry loaded before the editor unmounted', async () => {
      const page = loadPage(orgA)
      fetchCustomFieldFormStructureMock.mockResolvedValueOnce({ definitions: [notes] })
      const first = renderHook(() => page.useCalendarCustomFields(true, entityId, NO_FIELDSETS))
      await waitFor(() => expect(first.result.current.status).toBe('ready'))
      first.unmount()

      page.reportOnly(orgA)
      page.switchTo(orgB)

      fetchCustomFieldFormStructureMock.mockReturnValueOnce(new Promise(() => {}))
      const second = renderHook(() => page.useCalendarCustomFields(true, entityId, NO_FIELDSETS))
      expect(second.result.current.status).toBe('loading')
      expect(second.result.current.allDefinitions).toEqual([])
    })

    it('does not give the next organization an answer that arrived after the editor unmounted', async () => {
      const page = loadPage(orgA)
      const pending = queueReads(fetchCustomFieldFormStructureMock)
      const first = renderHook(() => page.useCalendarCustomFields(true, entityId, NO_FIELDSETS))
      first.unmount()

      page.reportOnly(orgA)
      await act(async () => { pending.forEach((read) => read.resolve({ definitions: [notes] })) })
      page.switchTo(orgB)

      const second = renderHook(() => page.useCalendarCustomFields(true, entityId, NO_FIELDSETS))
      expect(second.result.current.status).toBe('loading')
      expect(second.result.current.allDefinitions).toEqual([])
    })

    it('does not reuse a read made before any scope cookie existed', async () => {
      const page = loadPage(null)
      fetchCustomFieldFormStructureMock.mockResolvedValueOnce({ definitions: [notes] })
      const { result } = renderHook(() => page.useCalendarCustomFields(true, entityId, NO_FIELDSETS))
      await waitFor(() => expect(result.current.status).toBe('ready'))

      fetchCustomFieldFormStructureMock.mockRejectedValueOnce(new Error('offline'))
      page.switchTo(orgA)
      expect(result.current.status).toBe('loading')
      expect(result.current.fields).toEqual([])

      await waitFor(() => expect(result.current.status).toBe('error'))
      expect(result.current.fields).toEqual([])
    })
  })

  describe('when a refresh of confirmed definitions is rejected', () => {
    async function reopenWithPendingRead() {
      fetchCustomFieldFormStructureMock.mockResolvedValueOnce({ definitions: [notes] })
      const view = renderHook(({ open }) => useCalendarCustomFields(open, entityId, NO_FIELDSETS), { initialProps: { open: true } })
      await waitFor(() => expect(view.result.current.status).toBe('ready'))
      view.rerender({ open: false })
      await act(async () => {})
      const pending = queueReads(fetchCustomFieldFormStructureMock)
      view.rerender({ open: true })
      expect(view.result.current.status).toBe('ready')
      return { ...view, pending }
    }

    it('fails closed, keeps the fields for the open draft and recovers only on a successful retry', async () => {
      const { result, pending } = await reopenWithPendingRead()
      await act(async () => { pending.shift()?.reject(Object.assign(new Error('forbidden'), { status: 403 })) })

      expect(result.current.status).toBe('stale')
      expect(result.current.fields.map((field) => field.id)).toEqual(['cf_visit_notes'])

      await act(async () => { result.current.retry() })
      expect(result.current.status).toBe('stale')
      await act(async () => { pending.shift()?.reject(new Error('offline')) })
      expect(result.current.status).toBe('stale')

      await act(async () => { result.current.retry() })
      await act(async () => { pending.shift()?.resolve({ definitions: [notes] }) })
      expect(result.current.status).toBe('ready')
      expect(result.current.fields.map((field) => field.id)).toEqual(['cf_visit_notes'])
    })

    it('stays failed through a retry after a first load failed, so a mounted form is not replaced', async () => {
      const pending = queueReads(fetchCustomFieldFormStructureMock)
      const { result } = renderHook(() => useCalendarCustomFields(true, entityId, NO_FIELDSETS))
      await act(async () => { pending.shift()?.reject(new Error('offline')) })
      expect(result.current.status).toBe('error')

      await act(async () => { result.current.retry() })
      expect(result.current.status).toBe('error')
      await act(async () => { pending.shift()?.resolve({ definitions: [notes] }) })
      expect(result.current.status).toBe('ready')
    })

    it('never carries the kept fields into another organization', async () => {
      const { result, pending } = await reopenWithPendingRead()
      await act(async () => { pending.shift()?.reject(new Error('offline')) })
      expect(result.current.status).toBe('stale')

      switchScope(orgB)

      expect(result.current.status).toBe('loading')
      expect(result.current.fields).toEqual([])
    })
  })
})
