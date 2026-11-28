/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DefaultValueField } from '@open-mercato/core/modules/feature_toggles/components/formConfig'
import { normalizeDefaultValueForType } from '@open-mercato/core/modules/feature_toggles/lib/defaultValue'

function renderField(type: string, value: unknown) {
  render(
    <I18nProvider locale="en" dict={{}}>
      <DefaultValueField
        {...({ id: 'defaultValue', value, setValue: () => {}, setFormValue: () => {}, values: { type } } as unknown as React.ComponentProps<typeof DefaultValueField>)}
      />
    </I18nProvider>,
  )
}

describe('DefaultValueField shows the value that will be persisted (#8859)', () => {
  it.each([
    ['number', true],
    ['number', 'abc'],
    ['number', '42.5'],
    ['string', 42.5],
    ['string', false],
  ])('type %s with leftover %p', (type, leftover) => {
    renderField(type, leftover)
    const input = screen.getByRole(type === 'number' ? 'spinbutton' : 'textbox') as HTMLInputElement
    expect(input.value).toBe(String(normalizeDefaultValueForType(type, leftover)))
  })
})
