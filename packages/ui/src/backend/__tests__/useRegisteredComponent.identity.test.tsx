/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { z } from 'zod'
import {
  registerComponent,
  registerComponentOverrides,
} from '@open-mercato/shared/modules/widgets/component-registry'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentOverrideProvider, useOverrideUserFeatures } from '../injection/ComponentOverrideProvider'
import { useRegisteredComponent } from '../injection/useRegisteredComponent'

jest.mock('../utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: { granted: ['acme.override'] } })),
}))

type FieldProps = { label?: string }

const mounts = { count: 0 }

function StatefulField({ label }: FieldProps) {
  React.useEffect(() => {
    mounts.count += 1
  }, [])
  return (
    <label>
      {label ?? 'field'}
      <input data-testid="field" defaultValue="" />
    </label>
  )
}

function FeaturesProbe() {
  const features = useOverrideUserFeatures()
  return <span data-testid="features">{features.join(',')}</span>
}

function typeIntoField(value: string) {
  fireEvent.change(screen.getByTestId('field'), { target: { value } })
}

describe('useRegisteredComponent identity', () => {
  beforeEach(() => {
    mounts.count = 0
    registerComponentOverrides([])
  })

  afterEach(() => {
    registerComponentOverrides([])
  })

  it('keeps the subtree mounted when override user features resolve after first paint', async () => {
    const componentId = 'test.identity.features'
    registerComponent({ id: componentId, component: StatefulField, metadata: { module: 'test' } })

    function Consumer() {
      const Resolved = useRegisteredComponent<FieldProps>(componentId)
      return <Resolved />
    }

    // The override targets a different component, so the resolution result for
    // `componentId` is identical before and after the feature grant arrives.
    const overrides: ComponentOverride[] = [
      {
        target: { componentId: 'test.identity.other' },
        priority: 10,
        features: ['acme.override'],
        metadata: { module: 'test' },
        propsTransform: (props: unknown) => props,
      } as ComponentOverride,
    ]

    render(
      <ComponentOverrideProvider overrides={overrides}>
        <FeaturesProbe />
        <Consumer />
      </ComponentOverrideProvider>,
    )

    typeIntoField('admin@acme.com')
    expect(mounts.count).toBe(1)

    await waitFor(() => expect(screen.getByTestId('features')).toHaveTextContent('acme.override'))

    expect(mounts.count).toBe(1)
    expect(screen.getByTestId('field')).toHaveValue('admin@acme.com')
  })

  it('keeps the subtree mounted when overrides are registered late', async () => {
    const componentId = 'test.identity.late'
    registerComponent({ id: componentId, component: StatefulField, metadata: { module: 'test' } })

    function Consumer() {
      const Resolved = useRegisteredComponent<FieldProps>(componentId)
      return <Resolved />
    }

    const lateOverrides: ComponentOverride[] = [
      {
        target: { componentId: 'test.identity.late.other' },
        priority: 10,
        metadata: { module: 'test' },
        propsTransform: (props: unknown) => props,
      } as ComponentOverride,
    ]

    const { rerender } = render(
      <ComponentOverrideProvider overrides={[]}>
        <Consumer />
      </ComponentOverrideProvider>,
    )

    typeIntoField('typed before the registry settled')
    expect(mounts.count).toBe(1)

    await act(async () => {
      rerender(
        <ComponentOverrideProvider overrides={lateOverrides}>
          <Consumer />
        </ComponentOverrideProvider>,
      )
    })

    expect(mounts.count).toBe(1)
    expect(screen.getByTestId('field')).toHaveValue('typed before the registry settled')
  })

  it('keeps a wrapper-wrapped subtree mounted across override re-registrations', async () => {
    const componentId = 'test.identity.wrapped'
    registerComponent({ id: componentId, component: StatefulField, metadata: { module: 'test' } })

    const wrapper = (Original: React.ComponentType<FieldProps>) => {
      const Wrapped = (props: FieldProps) => (
        <div data-testid="wrapped">
          <Original {...props} />
        </div>
      )
      Wrapped.displayName = 'Wrapped'
      return Wrapped
    }

    const buildOverrides = (): ComponentOverride[] => [
      { target: { componentId }, priority: 10, metadata: { module: 'test' }, wrapper } as unknown as ComponentOverride,
    ]

    function Consumer() {
      const Resolved = useRegisteredComponent<FieldProps>(componentId)
      return <Resolved />
    }

    const { rerender } = render(
      <ComponentOverrideProvider overrides={buildOverrides()}>
        <Consumer />
      </ComponentOverrideProvider>,
    )

    expect(screen.getByTestId('wrapped')).toBeInTheDocument()
    typeIntoField('typed inside a wrapped section')
    expect(mounts.count).toBe(1)

    // A new array with the same wrapper function — what a provider re-render looks like.
    await act(async () => {
      rerender(
        <ComponentOverrideProvider overrides={buildOverrides()}>
          <Consumer />
        </ComponentOverrideProvider>,
      )
    })

    expect(mounts.count).toBe(1)
    expect(screen.getByTestId('field')).toHaveValue('typed inside a wrapped section')
  })

  it('composes a wrapper at most once per (wrapper, wrapped component) pair', async () => {
    // The user-visible consequence is covered by the test above; this one pins the
    // cache's own contract, so that dropping the memoization fails loudly and the
    // purity requirement documented on the `wrapper` override member stays executable.
    const componentId = 'test.identity.wrapper-composition'
    const Base = (props: FieldProps) => <StatefulField {...props} />
    Base.displayName = 'Base'
    registerComponent({ id: componentId, component: Base, metadata: { module: 'test' } })

    let compositions = 0
    const wrapper = (Original: React.ComponentType<FieldProps>) => {
      compositions += 1
      const Wrapped = (props: FieldProps) => (
        <div data-testid="wrapped">
          <Original {...props} />
        </div>
      )
      Wrapped.displayName = 'Wrapped'
      return Wrapped
    }

    const buildOverrides = (): ComponentOverride[] => [
      { target: { componentId }, priority: 10, metadata: { module: 'test' }, wrapper } as unknown as ComponentOverride,
    ]

    function Consumer() {
      const Resolved = useRegisteredComponent<FieldProps>(componentId)
      return <Resolved />
    }

    const { rerender } = render(
      <ComponentOverrideProvider overrides={buildOverrides()}>
        <Consumer />
      </ComponentOverrideProvider>,
    )

    expect(screen.getByTestId('wrapped')).toBeInTheDocument()
    expect(compositions).toBe(1)

    for (let pass = 0; pass < 2; pass += 1) {
      await act(async () => {
        rerender(
          <ComponentOverrideProvider overrides={buildOverrides()}>
            <Consumer />
          </ComponentOverrideProvider>,
        )
      })
    }

    expect(compositions).toBe(1)
    expect(mounts.count).toBe(1)
  })

  it('still applies a replacement that becomes active after the first render', async () => {
    const componentId = 'test.identity.replacement'
    const Original = () => <span data-testid="rendered">original</span>
    const Replacement = () => <span data-testid="rendered">replacement</span>
    registerComponent({ id: componentId, component: Original, metadata: { module: 'test' } })

    function Consumer() {
      const Resolved = useRegisteredComponent<FieldProps>(componentId)
      return <Resolved />
    }

    const lateOverrides: ComponentOverride[] = [
      {
        target: { componentId },
        priority: 100,
        metadata: { module: 'test' },
        replacement: Replacement,
        propsSchema: z.object({}).passthrough(),
      } as unknown as ComponentOverride,
    ]

    const { rerender } = render(
      <ComponentOverrideProvider overrides={[]}>
        <Consumer />
      </ComponentOverrideProvider>,
    )
    expect(screen.getByTestId('rendered')).toHaveTextContent('original')

    await act(async () => {
      rerender(
        <ComponentOverrideProvider overrides={lateOverrides}>
          <Consumer />
        </ComponentOverrideProvider>,
      )
    })

    expect(screen.getByTestId('rendered')).toHaveTextContent('replacement')
  })

  it('cannot save a subtree whose host re-creates the fallback on every render', () => {
    const componentId = 'test.identity.inline-fallback'

    function Consumer({ label }: { label: string }) {
      // A fallback declared inside the host's render body is a new function on
      // every render, and with no component registered under this id it *is*
      // the component being rendered. The hook keeps its own identity stable,
      // but it cannot make the caller's fallback stable — React sees a new
      // element type below and must remount. Hosts that care about the state
      // under an unregistered id have to hoist the fallback out of render.
      const Fallback = (props: FieldProps) => <StatefulField {...props} />
      const Resolved = useRegisteredComponent<FieldProps>(componentId, Fallback)
      return <Resolved label={label} />
    }

    const { rerender } = render(<Consumer label="first" />)
    typeIntoField('typed against an inline fallback')
    expect(mounts.count).toBe(1)

    rerender(<Consumer label="second" />)

    expect(mounts.count).toBe(2)
  })

  it('remounts when the host asks for a different component id', () => {
    function Consumer({ componentId }: { componentId: string }) {
      const Resolved = useRegisteredComponent<FieldProps>(componentId, StatefulField)
      return <Resolved />
    }

    const { rerender } = render(<Consumer componentId="test.identity.provider-a" />)
    typeIntoField('provider a input')
    expect(mounts.count).toBe(1)

    rerender(<Consumer componentId="test.identity.provider-b" />)

    expect(mounts.count).toBe(2)
    expect(screen.getByTestId('field')).toHaveValue('')
  })
})
