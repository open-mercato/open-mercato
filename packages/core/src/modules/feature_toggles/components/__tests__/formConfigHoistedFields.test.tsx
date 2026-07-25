/**
 * @jest-environment jsdom
 *
 * Regression coverage for #3616: the feature_toggles default-value and
 * override-value renderers used to be plain render helpers that called useT() on
 * their first line. CrudForm invokes a custom field's `component` as a bare
 * function call (`field.component({...})`), so useT() ran inside the *caller's*
 * render frame and only for the field that was actually mounted — a conditional
 * hook. The renderers are now real hoisted components (DefaultValueField /
 * OverrideValueField) referenced via `component: (props) => <Comp {...props} />`,
 * so the hook runs inside the component's own boundary. Mirrors #3173.
 */
import * as React from 'react'
import * as fs from 'fs'
import * as path from 'path'
import { render } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { createFieldDefinitions } from '@open-mercato/core/modules/feature_toggles/components/formConfig'
import { createOverrideFieldDefinitions } from '@open-mercato/core/modules/feature_toggles/components/overrideFormConfig'

const t = (key: string) => key

type CustomComponent = (props: Record<string, unknown>) => React.ReactNode

function getCustomComponent(fields: Array<{ id: string; component?: CustomComponent }>, id: string): CustomComponent {
  const field = fields.find((f) => f.id === id)
  if (!field?.component) throw new Error(`missing custom component for ${id}`)
  return field.component
}

// Mimics how CrudForm hosts a custom field: the host owns hooks and then invokes
// `field.component({...})` as a bare function call. If that call runs a hook
// (the bug), toggling whether the field is shown changes the host's hook count
// and React throws. When the component returns JSX that mounts a real component,
// the host's hook count is stable.
function Host({ show, component, fieldProps }: { show: boolean; component: CustomComponent; fieldProps: Record<string, unknown> }) {
  const [marker] = React.useState('marker')
  return (
    <div data-marker={marker}>{show ? component(fieldProps) : null}</div>
  )
}

const defaultFieldProps = {
  id: 'defaultValue',
  value: true,
  setValue: () => {},
  setFormValue: () => {},
  values: { type: 'boolean' },
}

const overrideFieldProps = {
  id: 'overrideValue',
  value: true,
  setValue: () => {},
  setFormValue: () => {},
  values: { toggleType: 'boolean', isOverride: true },
}

describe('feature_toggles hoisted custom field components (#3616)', () => {
  it('keeps host hook count stable when the default-value field mounts/unmounts', () => {
    const component = getCustomComponent(createFieldDefinitions(t) as any, 'defaultValue')
    const { rerender } = render(
      <I18nProvider locale="en" dict={{}}>
        <Host show={false} component={component} fieldProps={defaultFieldProps} />
      </I18nProvider>,
    )
    expect(() => {
      rerender(
        <I18nProvider locale="en" dict={{}}>
          <Host show component={component} fieldProps={defaultFieldProps} />
        </I18nProvider>,
      )
    }).not.toThrow()
  })

  it('keeps host hook count stable when the override-value field mounts/unmounts', () => {
    const component = getCustomComponent(createOverrideFieldDefinitions(t) as any, 'overrideValue')
    const { rerender } = render(
      <I18nProvider locale="en" dict={{}}>
        <Host show={false} component={component} fieldProps={overrideFieldProps} />
      </I18nProvider>,
    )
    expect(() => {
      rerender(
        <I18nProvider locale="en" dict={{}}>
          <Host show component={component} fieldProps={overrideFieldProps} />
        </I18nProvider>,
      )
    }).not.toThrow()
  })

  it('renders the default-value boolean selector', () => {
    const component = getCustomComponent(createFieldDefinitions(t) as any, 'defaultValue')
    const { container } = render(
      <I18nProvider locale="en" dict={{}}>
        <div>{component(defaultFieldProps)}</div>
      </I18nProvider>,
    )
    expect(container.textContent).toContain('Default Value (Boolean)')
  })
})

describe('feature_toggles hoisted custom field components — structural (#3616)', () => {
  const formSource = fs.readFileSync(path.join(__dirname, '..', 'formConfig.tsx'), 'utf8')
  const overrideSource = fs.readFileSync(path.join(__dirname, '..', 'overrideFormConfig.tsx'), 'utf8')

  it('declares DefaultValueField at module scope and wires it as a component element', () => {
    expect(formSource).toMatch(/^export function DefaultValueField\b/m)
    expect(formSource).toMatch(/<DefaultValueField\b/)
    expect(formSource).not.toMatch(/renderDefaultValueCreateComponent/)
  })

  it('declares OverrideValueField at module scope and wires it as a component element', () => {
    expect(overrideSource).toMatch(/^export function OverrideValueField\b/m)
    expect(overrideSource).toMatch(/<OverrideValueField\b/)
    expect(overrideSource).not.toMatch(/renderOverrideValueComponent/)
  })
})
