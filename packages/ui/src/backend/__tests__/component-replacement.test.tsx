import * as React from 'react'
import { render, screen } from '@testing-library/react'
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
})
