/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

import { LogCausePanel } from '../LogCausePanel'
import { AccessWhyPanel } from '../AccessWhyPanel'
import { normalizeAccessExplanation } from '../../lib/client/accessExplanation'
import { DEAL_ID, DICT, LOG_NEWEST, apiOk, apiStatus, cause, logResponse } from './fixtures'

function renderUi(ui: React.ReactElement) {
  return renderWithProviders(ui, { dict: DICT })
}

function requestedUrl(callIndex: number): URL {
  return new URL(String(mockApiCall.mock.calls[callIndex][0]), 'http://localhost')
}

describe('LogCausePanel', () => {
  beforeEach(() => mockApiCall.mockReset())

  it('explains the cause of one audit entry', async () => {
    mockApiCall.mockResolvedValueOnce(apiOk(logResponse()))
    renderUi(<LogCausePanel logId={LOG_NEWEST} />)
    expect(screen.getByText('Loading explanation…')).toBeInTheDocument()
    expect(await screen.findByText('Recorded cause')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Workflow: Order approval' })).toHaveAttribute('href', '/backend/workflows/instances/wf-1')
    expect(screen.getByText('Alice Admin')).toBeInTheDocument()
    expect(screen.getByText('Proven')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Explain the record' })).toHaveAttribute(
      'href',
      `/backend/insights/why?resourceKind=customers.deal&resourceId=${DEAL_ID}`,
    )
    const url = requestedUrl(0)
    expect(url.pathname).toBe('/api/insights/explain/log')
    expect(url.searchParams.get('logId')).toBe(LOG_NEWEST)
  })

  it('hides the actor of another user when redacted', async () => {
    mockApiCall.mockResolvedValueOnce(apiOk(logResponse({
      actor: { kind: 'user', id: null, label: null, isSelf: false, redacted: true },
      cause: cause({ kind: 'user', available: false }),
    })))
    renderUi(<LogCausePanel logId={LOG_NEWEST} />)
    expect(await screen.findByText('Another user')).toBeInTheDocument()
    expect(screen.queryByText(/Alice/)).toBeNull()
  })

  it('renders a no-access state without retry for a 403', async () => {
    mockApiCall.mockResolvedValueOnce(apiStatus(403, { error: 'tenant_required' }))
    renderUi(<LogCausePanel logId={LOG_NEWEST} />)
    expect(await screen.findByText('Explanation not available')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('renders a not-found state for an invisible entry', async () => {
    mockApiCall.mockResolvedValueOnce(apiStatus(404, { error: 'not_found' }))
    renderUi(<LogCausePanel logId={LOG_NEWEST} />)
    expect(await screen.findByText('The cause of this change is not available.')).toBeInTheDocument()
  })

  it('retries after an error', async () => {
    mockApiCall.mockResolvedValueOnce(apiStatus(500)).mockResolvedValueOnce(apiOk(logResponse()))
    renderUi(<LogCausePanel logId={LOG_NEWEST} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Recorded cause')).toBeInTheDocument()
  })
})

describe('AccessWhyPanel', () => {
  beforeEach(() => mockApiCall.mockReset())

  it('explains a denied decision with its summary, reasons and per-feature status', async () => {
    mockApiCall.mockResolvedValueOnce(apiOk({
      decision: 'denied',
      required: [
        { feature: 'customers.deals.view', granted: true },
        { feature: 'customers.deals.manage', granted: false },
      ],
      reasons: ['missing_feature'],
      summary: {
        key: 'insights.explain.access.summary.missingFeature',
        params: { features: 'customers.deals.manage', count: 1 },
      },
      detail: null,
      confidence: 'proven',
    }))
    renderUi(<AccessWhyPanel requiredFeatures={['customers.deals.view', 'customers.deals.manage', 'customers.deals.view']} path="/backend/customers/deals" />)
    expect(await screen.findByText('Access denied')).toBeInTheDocument()
    expect(screen.getByText(/Missing permissions: customers\.deals\.manage\./)).toBeInTheDocument()
    expect(screen.getByText('A required permission is not granted to you.')).toBeInTheDocument()
    const missing = screen.getByText('customers.deals.manage', { selector: 'code' }).closest('li') as HTMLElement
    expect(missing).toHaveAttribute('data-granted', 'false')
    expect(missing).toHaveTextContent('Missing')
    expect(screen.getByText('customers.deals.view', { selector: 'code' }).closest('li')).toHaveTextContent('Granted')
    expect(screen.queryByTestId('insights-access-detail')).toBeNull()
    const url = requestedUrl(0)
    expect(url.pathname).toBe('/api/insights/explain/access')
    expect(url.searchParams.get('features')).toBe('customers.deals.view,customers.deals.manage')
    expect(url.searchParams.get('path')).toBe('/backend/customers/deals')
  })

  it('renders the access detail when the server returns it', async () => {
    mockApiCall.mockResolvedValueOnce(apiOk({
      decision: 'denied',
      required: [{ feature: 'sales.orders.view', granted: false }],
      reasons: ['missing_feature', 'unexpected_reason'],
      summary: { key: 'insights.explain.access.summary.missingFeature', params: { features: 'sales.orders.view', count: 1 } },
      detail: {
        subject: { kind: 'user', id: 'u1', isSelf: true },
        source: 'roles',
        organizationId: 'org-1',
        organizationAllowed: true,
        aclOrganizations: null,
        features: [{ feature: 'sales.orders.view', granted: false, reason: 'missing_feature' }],
        userAcl: null,
        roles: [{ id: 'r1', name: 'Employee', isSuperAdmin: false, organizations: null, appliesToOrganization: true, grantedFeatures: [] }],
        rolesThatWouldGrant: [
          { id: 'r2', name: 'Sales manager', isSuperAdmin: false, organizations: ['org-2'], appliesToOrganization: false, grantedFeatures: ['sales.orders.view'] },
        ],
        grantedOrganizationIds: [],
        organizationsRedacted: false,
        recentChanges: [
          { logId: 'l1', at: '2026-10-01T10:15:00.000Z', kind: 'role_acl', resourceId: 'r1', commandId: 'auth.roles.acl.update', actionLabel: null },
        ],
        consistentWithFreshRead: true,
      },
      confidence: 'inferred',
    }))
    renderUi(<AccessWhyPanel requiredFeatures={['sales.orders.view']} />)
    expect(await screen.findByTestId('insights-access-detail')).toBeInTheDocument()
    expect(screen.getByText('Assigned roles')).toBeInTheDocument()
    expect(screen.getByText('Employee')).toBeInTheDocument()
    expect(screen.getByText('Sales manager')).toBeInTheDocument()
    expect(screen.getByText('(other organizations only)')).toBeInTheDocument()
    expect(screen.getByText('Role permissions changed')).toBeInTheDocument()
    expect(screen.getByText('Inferred')).toBeInTheDocument()
  })

  it('notes hidden recent changes when the viewer cannot read audit history', async () => {
    mockApiCall.mockResolvedValueOnce(apiOk({
      decision: 'granted',
      required: [{ feature: 'sales.orders.view', granted: true }],
      reasons: [],
      summary: { key: 'insights.explain.access.summary.granted', params: { count: 1 } },
      detail: { source: 'user_acl', organizationAllowed: false, roles: [], rolesThatWouldGrant: [], recentChanges: null },
      confidence: 'proven',
    }))
    renderUi(<AccessWhyPanel requiredFeatures={['sales.orders.view']} />)
    expect(await screen.findByText('Not shown because you cannot view the audit history.')).toBeInTheDocument()
    expect(screen.getByText('Personal permissions, which replace role permissions')).toBeInTheDocument()
    expect(screen.getByText('The selected organization is outside your allowed scope.')).toBeInTheDocument()
    expect(screen.getByText('Every required permission is granted (1).')).toBeInTheDocument()
  })

  it('leaves out the roles that would grant when the server omits them (no auth.roles.list)', async () => {
    mockApiCall.mockResolvedValueOnce(apiOk({
      decision: 'denied',
      required: [{ feature: 'sales.orders.view', granted: false }],
      reasons: ['missing_feature'],
      summary: { key: 'insights.explain.access.summary.missingFeature', params: { features: 'sales.orders.view', count: 1 } },
      detail: { source: 'roles', organizationAllowed: true, roles: [{ id: 'r1', name: 'Employee' }], recentChanges: null },
      confidence: 'proven',
    }))
    renderUi(<AccessWhyPanel requiredFeatures={['sales.orders.view']} />)
    expect(await screen.findByText('Employee')).toBeInTheDocument()
    expect(screen.getByText('Assigned roles')).toBeInTheDocument()
    expect(screen.queryByText('Roles that would grant access')).not.toBeInTheDocument()
  })

  it('renders a forbidden state', async () => {
    mockApiCall.mockResolvedValueOnce(apiStatus(403))
    renderUi(<AccessWhyPanel requiredFeatures={['sales.orders.view']} />)
    expect(await screen.findByText('Explanation not available')).toBeInTheDocument()
  })

  it('refuses to explain a partial feature list instead of reporting a misleading decision', async () => {
    renderUi(<AccessWhyPanel requiredFeatures={['sales.orders.view', 'sales.*', ' ']} />)
    expect(await screen.findByText('This access rule cannot be explained')).toBeInTheDocument()
    expect(mockApiCall).not.toHaveBeenCalled()
  })

  it('retries after an error and treats an invalid body as an error', async () => {
    mockApiCall.mockResolvedValueOnce(apiOk({ decision: 'maybe' })).mockResolvedValueOnce(apiOk({
      decision: 'granted',
      required: [{ feature: 'sales.orders.view', granted: true }],
      reasons: [],
      summary: null,
      detail: null,
      confidence: 'proven',
    }))
    renderUi(<AccessWhyPanel requiredFeatures={['sales.orders.view']} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Access granted')).toBeInTheDocument()
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2))
  })
})

describe('normalizeAccessExplanation', () => {
  it('drops unknown reasons and keeps only well-formed requirements', () => {
    expect(normalizeAccessExplanation({
      decision: 'denied',
      required: [{ feature: 'a.b', granted: true }, { granted: false }, 'x'],
      reasons: ['missing_feature', 'missing_feature', 'other'],
      detail: null,
      confidence: 'weird',
    })).toEqual({
      decision: 'denied',
      required: [{ feature: 'a.b', granted: true }],
      reasons: ['missing_feature'],
      summary: null,
      detail: null,
      confidence: 'unknown',
    })
  })

  it('rejects a body without a decision', () => {
    expect(normalizeAccessExplanation({ required: [] })).toBeNull()
    expect(normalizeAccessExplanation(null)).toBeNull()
  })
})
