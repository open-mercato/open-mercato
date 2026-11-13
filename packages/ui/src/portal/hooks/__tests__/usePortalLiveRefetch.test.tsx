/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import type { AppEventPayload } from '@open-mercato/shared/modules/widgets/injection'
import { APP_EVENT_DOM_NAME, BRIDGE_RECONNECTED_EVENT_ID } from '../../../backend/injection/useAppEvent'
import { PORTAL_BRIDGE_RECONNECTED_EVENT_ID, PORTAL_EVENT_DOM_NAME } from '../usePortalAppEvent'
import { usePortalLiveRefetch } from '../usePortalLiveRefetch'

function emit(id: string, payload: Record<string, unknown> = {}, domName = PORTAL_EVENT_DOM_NAME) {
  const detail = { id, payload } as AppEventPayload
  act(() => {
    window.dispatchEvent(new CustomEvent(domName, { detail }))
  })
}

const isClaimOne = (event: AppEventPayload) => event.payload.claimId === 'claim-1'

describe('usePortalLiveRefetch', () => {
  it('exports the wire value used by the portal bridge', () => {
    expect(PORTAL_BRIDGE_RECONNECTED_EVENT_ID).toBe('om:portal-bridge:reconnected')
  })

  it('refetches without arguments on a matching portal event', () => {
    const refetch = jest.fn()
    renderHook(() => usePortalLiveRefetch('warranty_claims.claim.*', refetch, { filter: isClaimOne }))

    emit('warranty_claims.claim.comment_added', { claimId: 'claim-1' })

    expect(refetch).toHaveBeenCalledTimes(1)
    expect(refetch).toHaveBeenCalledWith()
  })

  it('ignores filtered-out, unmatched and backend-channel events', () => {
    const refetch = jest.fn()
    renderHook(() => usePortalLiveRefetch('warranty_claims.claim.*', refetch, { filter: isClaimOne }))

    emit('warranty_claims.claim.comment_added', { claimId: 'claim-2' })
    emit('sales.order.status_changed', { claimId: 'claim-1' })
    emit('warranty_claims.claim.comment_added', { claimId: 'claim-1' }, APP_EVENT_DOM_NAME)
    emit(BRIDGE_RECONNECTED_EVENT_ID, {}, APP_EVENT_DOM_NAME)

    expect(refetch).not.toHaveBeenCalled()
  })

  it('refetches on portal reconnect even when the filter would reject it', () => {
    const refetch = jest.fn()
    const filter = jest.fn(() => false)
    renderHook(() => usePortalLiveRefetch('warranty_claims.claim.*', refetch, { filter }))

    emit(PORTAL_BRIDGE_RECONNECTED_EVENT_ID)

    expect(refetch).toHaveBeenCalledTimes(1)
    expect(filter).not.toHaveBeenCalled()
  })

  it('removes its listener on unmount', () => {
    const refetch = jest.fn()
    const view = renderHook(() => usePortalLiveRefetch('warranty_claims.claim.*', refetch))
    view.unmount()

    emit('warranty_claims.claim.comment_added', { claimId: 'claim-1' })
    emit(PORTAL_BRIDGE_RECONNECTED_EVENT_ID)

    expect(refetch).not.toHaveBeenCalled()
  })
})
