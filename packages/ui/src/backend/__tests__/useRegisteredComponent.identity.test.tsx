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
