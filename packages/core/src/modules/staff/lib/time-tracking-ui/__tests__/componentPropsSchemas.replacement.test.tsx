/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import {
  getComponentEntry,
  registerComponent,
  registerComponentOverrides,
  type ComponentOverride,
  type ComponentRegistryEntry,
} from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import {
  timeEntryDialogPropsSchema,
  type TimeEntryDialogProps,
} from '@open-mercato/core/modules/staff/lib/time-tracking-ui/TimeEntryDialog'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

const componentId = extensionPoints.hosts.timeEntryDialogComponent.componentId

function HostDefault() {
  return <div data-testid="host-default" />
}

function Replacement({ open }: TimeEntryDialogProps) {
  return <div data-testid="replacement">{open ? 'open' : 'closed'}</div>
}

const replacementOverride: ComponentOverride<TimeEntryDialogProps> = {
  target: { componentId },
  priority: 50,
  metadata: { module: 'replacement_test' },
  replacement: Replacement,
  propsSchema: timeEntryDialogPropsSchema,
}

function Host(props: Record<string, unknown>) {
  const Resolved = useRegisteredComponent<Record<string, unknown>>(componentId)
  return <Resolved {...props} />
}

describe('a replacement built on the exported time entry dialog props schema', () => {
  let registeredEntry: ComponentRegistryEntry | null = null
  let consoleError: jest.SpyInstance

  beforeAll(() => {
    registeredEntry = getComponentEntry(componentId)
    registerComponent<TimeEntryDialogProps>({
      id: componentId,
      component: HostDefault,
      metadata: { module: 'staff', propsSchema: timeEntryDialogPropsSchema },
    })
  })

  afterAll(() => {
    if (registeredEntry) registerComponent(registeredEntry)
  })

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    registerComponentOverrides([replacementOverride as ComponentOverride])
  })

  afterEach(() => {
    registerComponentOverrides([])
    consoleError.mockRestore()
  })

  it('renders the replacement for minimal props that leave every optional callback out', () => {
    render(<Host open onOpenChange={() => {}} />)
    expect(screen.getByTestId('replacement')).toHaveTextContent('open')
    expect(screen.queryByTestId('host-default')).not.toBeInTheDocument()
  })

  it('renders the replacement when the optional callbacks and mode are passed', () => {
    render(<Host open={false} onOpenChange={() => {}} onSaved={() => {}} onShowEntry={() => {}} mode="project" />)
    expect(screen.getByTestId('replacement')).toHaveTextContent('closed')
  })

  it('falls back to the host component when a callback is not a function', () => {
    render(<Host open onOpenChange="nope" />)
    expect(screen.getByTestId('host-default')).toBeInTheDocument()
    expect(screen.queryByTestId('replacement')).not.toBeInTheDocument()
  })

  it('renders the host component once the override is removed', () => {
    registerComponentOverrides([])
    render(<Host open onOpenChange={() => {}} />)
    expect(screen.getByTestId('host-default')).toBeInTheDocument()
  })
})
