/**
 * @jest-environment jsdom
 *
 * Coverage for the AclDependencyDiagnosticsPanel. Verifies it:
 *  - hides when the granted set is empty
 *  - hides when the granted set contains global wildcard
 *  - surfaces missing dependencies
 *  - surfaces orphaned dependents
 *  - quick-action buttons call onGrantedChange with the right mutation
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { AclDependencyDiagnosticsPanel } from '../components/AclDependencyDiagnosticsPanel'

const fmt = (template: string, params?: Record<string, string | number>) => {
  if (!params) return template
  return Object.entries(params).reduce(
    (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
    template,
  )
}

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string, params?: Record<string, string | number>) =>
    fmt(fallback ?? _key, params),
}))

const catalog = [
  { id: 'customers.people.view', title: 'View people', module: 'customers' },
  {
    id: 'customers.people.manage',
    title: 'Manage people',
    module: 'customers',
    dependsOn: ['customers.people.view'],
  },
  {
    id: 'customers.deals.view',
    title: 'View deals',
    module: 'customers',
    dependsOn: ['customers.people.view'],
  },
  {
    id: 'customers.deals.manage',
    title: 'Manage deals',
    module: 'customers',
    dependsOn: ['customers.deals.view'],
  },
]

function renderPanel(granted: string[]) {
  const onGrantedChange = jest.fn()
  const utils = render(
    <AclDependencyDiagnosticsPanel
      granted={granted}
      catalog={catalog}
      onGrantedChange={(updater) => onGrantedChange(updater(granted))}
    />,
  )
  return { onGrantedChange, ...utils }
}

describe('AclDependencyDiagnosticsPanel', () => {
  it('renders nothing when granted set is empty', () => {
    renderPanel([])
    expect(screen.queryByTestId('acl-dependency-diagnostics')).toBeNull()
  })

  it('renders nothing when granted set contains global wildcard', () => {
    renderPanel(['*'])
    expect(screen.queryByTestId('acl-dependency-diagnostics')).toBeNull()
  })

  it('renders nothing when all granted features have their deps satisfied', () => {
    renderPanel(['customers.people.view', 'customers.people.manage'])
    expect(screen.queryByTestId('acl-dependency-diagnostics')).toBeNull()
  })

  it('shows a missing-dependency row when manage is granted without view', () => {
    renderPanel(['customers.people.manage'])
    expect(screen.getByTestId('acl-dependency-diagnostics')).toBeTruthy()
    expect(screen.getByTestId('missing-customers.people.manage')).toBeTruthy()
  })

  it('clicking Add adds the missing dep to granted', () => {
    const { onGrantedChange } = renderPanel(['customers.people.manage'])
    fireEvent.click(
      screen.getByTestId('add-missing-customers.people.manage-customers.people.view'),
    )
    expect(onGrantedChange).toHaveBeenCalledWith([
      'customers.people.manage',
      'customers.people.view',
    ])
  })

  it('shows an orphaned-dependent row when a parent is missing but child is granted', () => {
    renderPanel(['customers.people.manage', 'customers.deals.view'])
    // Both manage and deals.view depend on people.view (not granted)
    expect(screen.getByTestId('orphaned-customers.people.view')).toBeTruthy()
  })

  it('clicking Restore re-adds the parent', () => {
    const { onGrantedChange } = renderPanel(['customers.people.manage'])
    fireEvent.click(screen.getByTestId('restore-customers.people.view'))
    expect(onGrantedChange).toHaveBeenCalledWith([
      'customers.people.manage',
      'customers.people.view',
    ])
  })

  it('clicking Drop dependents removes the children from granted', () => {
    const granted = ['customers.people.manage', 'customers.deals.view']
    const { onGrantedChange } = renderPanel(granted)
    fireEvent.click(screen.getByTestId('drop-dependents-customers.people.view'))
    expect(onGrantedChange).toHaveBeenCalledWith([])
  })

  it('respects a module wildcard granting all child features', () => {
    renderPanel(['customers.*'])
    expect(screen.queryByTestId('acl-dependency-diagnostics')).toBeNull()
  })

  it('hides unknown-references section when hideUnknownReferences is true', () => {
    const odd = [
      { id: 'a', dependsOn: ['nonexistent.thing'] },
      { id: 'b' },
    ]
    render(
      <AclDependencyDiagnosticsPanel
        granted={['a']}
        catalog={odd}
        onGrantedChange={() => {}}
        hideUnknownReferences
      />,
    )
    expect(screen.queryByTestId('unknown-a')).toBeNull()
  })

  it('shows unknown-references section by default in dev', () => {
    const odd = [
      { id: 'a', dependsOn: ['nonexistent.thing'] },
    ]
    render(
      <AclDependencyDiagnosticsPanel
        granted={['a']}
        catalog={odd}
        onGrantedChange={() => {}}
      />,
    )
    expect(screen.getByTestId('unknown-a')).toBeTruthy()
  })
})
