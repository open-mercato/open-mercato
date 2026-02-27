/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { z } from 'zod'
import {
  registerComponent,
  registerComponentOverrides,
  ComponentReplacementHandles,
} from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '../injection/useRegisteredComponent'
import { DetailFieldsSection } from '../detail/DetailFieldsSection'

describe('component replacement', () => {
  afterEach(() => {
    registerComponentOverrides([])
  })

  it('falls back to passed component when no registry entry exists', () => {
    const Fallback = ({ value }: { value: string }) => <div>{value}</div>

    function Consumer() {
      const Resolved = useRegisteredComponent<{ value: string }>('missing.component', Fallback)
      return <Resolved value="fallback rendered" />
    }

    render(<Consumer />)
    expect(screen.getByText('fallback rendered')).toBeInTheDocument()
  })

  it('applies wrapper override around registered component', () => {
    const componentId = 'test.section'
    const Base = ({ value }: { value: string }) => <span>{value}</span>

    registerComponent({
      id: componentId,
      component: Base,
      metadata: {
        module: 'test',
      },
    })
    registerComponentOverrides([
      {
        target: { componentId },
        priority: 10,
        metadata: { module: 'test' },
        wrapper: (Original) => {
          const Wrapped = (props: { value: string }) => (
            <div data-testid="wrapped">
              <Original {...props} />
            </div>
          )
          Wrapped.displayName = 'Wrapped'
          return Wrapped
        },
      },
    ])

    function Consumer() {
      const Resolved = useRegisteredComponent<{ value: string }>(componentId)
      return <Resolved value="wrapped rendered" />
    }

    render(<Consumer />)
    expect(screen.getByTestId('wrapped')).toBeInTheDocument()
    expect(screen.getByText('wrapped rendered')).toBeInTheDocument()
  })

  it('renders section handle for DetailFieldsSection', () => {
    render(
      <DetailFieldsSection
        fields={[
          {
            key: 'name',
            kind: 'custom',
            label: 'Name',
            emptyLabel: '-',
            render: () => <span>Name</span>,
          },
        ]}
      />,
    )

    const handle = ComponentReplacementHandles.section('ui.detail', 'DetailFieldsSection')
    const wrapper = document.querySelector(`[data-component-handle="${handle}"]`)
    expect(wrapper).not.toBeNull()
  })

  it('falls back to original component when replacement props schema validation fails', () => {
    const componentId = 'test.replace.schema'
    const Original = ({ value }: { value: string }) => <span>original:{value}</span>
    const Replacement = ({ value }: { value: string }) => <span>replacement:{value}</span>
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    registerComponent({
      id: componentId,
      component: Original,
      metadata: { module: 'test' },
    })
    registerComponentOverrides([
      {
        target: { componentId },
        priority: 100,
        metadata: { module: 'test' },
        replacement: Replacement,
        propsSchema: z.object({ value: z.string().min(4) }),
      },
    ])

    function Consumer() {
      const Resolved = useRegisteredComponent<{ value: string }>(componentId)
      return <Resolved value="bad" />
    }

    render(<Consumer />)
    expect(screen.getByText('original:bad')).toBeInTheDocument()
    expect(screen.queryByText('replacement:bad')).toBeNull()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('uses highest-priority replacement when multiple replacements are registered', () => {
    const componentId = 'test.replace.priority'
    const Original = ({ value }: { value: string }) => <span>original:{value}</span>
    const LowPriorityReplacement = ({ value }: { value: string }) => <span>low:{value}</span>
    const HighPriorityReplacement = ({ value }: { value: string }) => <span>high:{value}</span>
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    registerComponent({
      id: componentId,
      component: Original,
      metadata: { module: 'test' },
    })
    registerComponentOverrides([
      {
        target: { componentId },
        priority: 50,
        metadata: { module: 'low-priority-module' },
        replacement: LowPriorityReplacement,
        propsSchema: z.object({ value: z.string() }),
      },
      {
        target: { componentId },
        priority: 100,
        metadata: { module: 'high-priority-module' },
        replacement: HighPriorityReplacement,
        propsSchema: z.object({ value: z.string() }),
      },
    ])

    function Consumer() {
      const Resolved = useRegisteredComponent<{ value: string }>(componentId)
      return <Resolved value="picked" />
    }

    render(<Consumer />)
    expect(screen.queryByText('low:picked')).toBeNull()
    expect(screen.getByText('high:picked')).toBeInTheDocument()
    expect(warnSpy).toHaveBeenCalledWith(
      `[UMES] Multiple replacements registered for "${componentId}". Highest-priority replacement is applied.`,
    )
    warnSpy.mockRestore()
  })

  it('applies propsTransform overrides before rendering', () => {
    const componentId = 'test.props.transform'
    const Base = ({ value, className }: { value: string; className?: string }) => (
      <span data-testid="props-transform-target" className={className}>
        {value}
      </span>
    )

    registerComponent({
      id: componentId,
      component: Base,
      metadata: { module: 'test' },
    })
    registerComponentOverrides([
      {
        target: { componentId },
        priority: 50,
        metadata: { module: 'props-transform-module' },
        propsTransform: (props: { value: string; className?: string }) => ({
          ...props,
          className: 'injected-class',
        }),
      },
    ])

    function Consumer() {
      const Resolved = useRegisteredComponent<{ value: string; className?: string }>(componentId)
      return <Resolved value="props transformed" />
    }

    render(<Consumer />)
    expect(screen.getByTestId('props-transform-target')).toHaveClass('injected-class')
    expect(screen.getByText('props transformed')).toBeInTheDocument()
  })

  it('falls back to original component when replacement crashes at render time', () => {
    const componentId = 'test.replace.crash'
    const Original = ({ value }: { value: string }) => <span>original:{value}</span>
    const CrashingReplacement = () => {
      throw new Error('replacement render crash')
    }
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    registerComponent({
      id: componentId,
      component: Original,
      metadata: { module: 'test' },
    })
    registerComponentOverrides([
      {
        target: { componentId },
        priority: 100,
        metadata: { module: 'crashing-module' },
        replacement: CrashingReplacement,
        propsSchema: z.object({ value: z.string() }),
      },
    ])

    function Consumer() {
      const Resolved = useRegisteredComponent<{ value: string }>(componentId)
      return <Resolved value="fallback" />
    }

    render(<Consumer />)
    expect(screen.getByText('original:fallback')).toBeInTheDocument()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
