/** @jest-environment node */

const executeWmsCustomPostRouteMock = jest.fn()

jest.mock('../inventory/helpers', () => ({
  executeWmsCustomPostRoute: (...args: unknown[]) => executeWmsCustomPostRouteMock(...args),
}))

import { NextResponse } from 'next/server'
import * as asnComplete from '../asns/[id]/complete/route'
import * as asnReceive from '../asns/[id]/receive/route'
import * as putawayAssign from '../putaway-tasks/[id]/assign/route'
import * as putawayCancel from '../putaway-tasks/[id]/cancel/route'
import * as putawayComplete from '../putaway-tasks/[id]/complete/route'
import * as putawayStart from '../putaway-tasks/[id]/start/route'
import * as reRunReservation from '../sales-orders/[salesOrderId]/re-run-reservation/route'

type RouteCase = {
  name: string
  paramKey: 'id' | 'salesOrderId'
  routePath: (id: string) => string
  post: (request: Request, routeContext: { params: Record<string, string> }) => Promise<Response>
}

function asRoutePost<TParams>(
  post: (request: Request, routeContext: { params: TParams }) => Promise<Response>,
): RouteCase['post'] {
  return (request, routeContext) => post(request, routeContext as { params: TParams })
}

const routes: RouteCase[] = [
  { name: 'putaway-tasks assign', paramKey: 'id', routePath: (id) => `wms/putaway-tasks/${id}/assign`, post: asRoutePost(putawayAssign.POST) },
  { name: 'putaway-tasks cancel', paramKey: 'id', routePath: (id) => `wms/putaway-tasks/${id}/cancel`, post: asRoutePost(putawayCancel.POST) },
  { name: 'putaway-tasks complete', paramKey: 'id', routePath: (id) => `wms/putaway-tasks/${id}/complete`, post: asRoutePost(putawayComplete.POST) },
  { name: 'putaway-tasks start', paramKey: 'id', routePath: (id) => `wms/putaway-tasks/${id}/start`, post: asRoutePost(putawayStart.POST) },
  { name: 'asns complete', paramKey: 'id', routePath: (id) => `wms/asns/${id}/complete`, post: asRoutePost(asnComplete.POST) },
  { name: 'asns receive', paramKey: 'id', routePath: (id) => `wms/asns/${id}/receive`, post: asRoutePost(asnReceive.POST) },
  {
    name: 'sales-orders re-run-reservation',
    paramKey: 'salesOrderId',
    routePath: (id) => `wms/sales-orders/${id}/re-run-reservation`,
    post: asRoutePost(reRunReservation.POST),
  },
]

function postRequest(): Request {
  return new Request('http://localhost/api/wms/route', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
}

describe('WMS custom POST routes path id validation', () => {
  beforeEach(() => {
    executeWmsCustomPostRouteMock.mockReset()
    executeWmsCustomPostRouteMock.mockResolvedValue(NextResponse.json({ ok: true }, { status: 200 }))
  })

  it.each(routes)('$name returns 400 for a malformed path id', async (route) => {
    const response = await route.post(postRequest(), { params: { [route.paramKey]: 'not-a-uuid' } })

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error?: string; details?: Array<{ path?: unknown[] }> }
    expect(body.error).toBe('Validation failed')
    expect(body.details?.map((issue) => issue.path)).toEqual([[route.paramKey]])
    expect(executeWmsCustomPostRouteMock).not.toHaveBeenCalled()
  })

  it.each(routes)('$name still delegates a valid path id', async (route) => {
    const id = '11111111-1111-4111-8111-111111111111'
    const response = await route.post(postRequest(), { params: { [route.paramKey]: id } })

    expect(response.status).toBe(200)
    expect(executeWmsCustomPostRouteMock).toHaveBeenCalledTimes(1)
    expect(executeWmsCustomPostRouteMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ routePath: route.routePath(id) }),
    )
  })
})
