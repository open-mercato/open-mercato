/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { InputParametersTab, type InputParametersTabProps } from '../backend/forms/[id]/studio/palette/InputParametersTab'
import plDict from '../i18n/pl.json'
import deDict from '../i18n/de.json'

function renderParameters(locale: string, dict: Record<string, string>) {
  const onAddLocale = jest.fn()
  const noop = jest.fn()
  const props: InputParametersTabProps = {
    formId: 'test-form', formKey: 'test', name: 'Test', description: '',
    supportedLocales: ['en'], defaultLocale: 'en', defaultActorRole: 'admin',
    declaredRoles: ['admin'], guestEnabled: false, density: 'default',
    labelPosition: 'top', pageMode: 'stacked', showProgress: false,
    hiddenFields: [], variables: [], schema: { type: 'object', properties: {}, 'x-om-sections': [] }, pagesCount: 1,
    onNameChange: noop, onDescriptionChange: noop, onToggleGuest: noop,
    onAddRole: noop, onRenameRole: noop, onRemoveRole: noop,
    onDefaultActorRoleChange: noop, onDensityChange: noop,
    onLabelPositionChange: noop, onPageModeChange: noop, onShowProgressChange: noop,
    onHiddenFieldsChange: noop, onVariablesChange: noop, onAddLocale,
    onRemoveLocale: noop, onDefaultLocaleChange: noop,
  }
  renderWithProviders(<InputParametersTab {...props} />, { locale, dict })
  return onAddLocale
}

describe('supported locale controls', () => {
  it.each([['pl', plDict], ['de', deDict]])('leaves room for the full %s add-button label', (locale, dict) => {
    renderParameters(locale, dict)
    const label = dict['forms.studio.parameters.locales.add']
    const input = screen.getByRole('textbox', { name: label })
    const button = screen.getByRole('button', { name: label })

    expect(input.closest('[data-slot="input-wrapper"]')).toHaveClass('min-w-0', 'flex-1', 'basis-20')
    expect(input.closest('[data-slot="input-wrapper"]')?.parentElement).toHaveClass('flex-wrap')
    expect(button).toHaveClass('shrink-0', 'whitespace-nowrap')
    expect(button).toHaveTextContent(label)
  })

  it('enables adding a valid new locale and clears the draft after submission', () => {
    const onAddLocale = renderParameters('pl', plDict)
    const label = plDict['forms.studio.parameters.locales.add']
    const input = screen.getByRole('textbox', { name: label })
    const button = screen.getByRole('button', { name: label })

    expect(button).toBeDisabled()
    fireEvent.change(input, { target: { value: 'en' } })
    expect(button).toBeDisabled()
    fireEvent.change(input, { target: { value: 'pl' } })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(onAddLocale).toHaveBeenCalledWith('pl')
    expect(input).toHaveValue('')
  })
})
