/** @jest-environment node */
jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}))
jest.mock('../api/routeContext', () => ({ resolveStaffContext: jest.fn(), handleRouteError: jest.fn() }))
jest.mock('../lib/managers', () => ({ listManagerCandidates: jest.fn(async () => []) }))

import { metadata } from '../api/manager-candidates/route'

describe('manager candidates GET', () => {
  it('requires property management access on top of managing every building', () => {
    expect(metadata.GET.requireFeatures).toEqual(['property_management.manage', 'property_management.buildings.manage_all'])
  })
})
