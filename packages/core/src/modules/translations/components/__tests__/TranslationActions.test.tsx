/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

const mockTranslationManager = jest.fn((_props: Record<string, unknown>) => <div data-testid="translation-manager" />)

jest.mock('../TranslationManager', () => ({
  TranslationManager: (props: Record<string, unknown>) => mockTranslationManager(props),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string, params?: Record<string, unknown>) =>
    (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (match, name: string) => String(params?.[name] ?? match)),
}))

import { DictionaryEntryTranslationAction, FieldDefinitionTranslationAction } from '../TranslationActions'

describe('translation action contributions', () => {
  beforeEach(() => {
    mockTranslationManager.mockClear()
  })

  it('opens dictionary translation with the entry identity and base label', () => {
    render(
      <DictionaryEntryTranslationAction
        context={{ dictionaryId: 'dictionary-one', entry: { id: 'entry-one', label: 'Preferred customer' } }}
      />,
    )

    expect(mockTranslationManager).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Translate Preferred customer' }))

    expect(screen.getByRole('dialog', { name: 'Translate: Preferred customer' })).toBeVisible()
    expect(screen.getByText('Manage translations for this dictionary entry.')).toBeVisible()
    expect(mockTranslationManager).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: 'embedded',
      entityType: 'dictionaries:dictionary_entry',
      recordId: 'entry-one',
      baseValues: { label: 'Preferred customer' },
      translatableFields: ['label'],
    }))
  })

  it('keeps dictionary actions disabled when the injection host disables them', () => {
    render(
      <DictionaryEntryTranslationAction
        context={{ dictionaryId: 'dictionary-one', entry: { id: 'entry-one', label: 'Preferred customer' } }}
        disabled
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Translate Preferred customer' })
    expect(trigger).toBeDisabled()
    fireEvent.click(trigger)
    expect(mockTranslationManager).not.toHaveBeenCalled()
  })

  it('requires a selected organization for dictionary entries and keeps field-definition translations available', () => {
    document.cookie = 'om_selected_org=__all__; path=/'
    try {
      render(
        <>
          <DictionaryEntryTranslationAction
            context={{ dictionaryId: 'dictionary-one', entry: { id: 'entry-one', label: 'Preferred customer' } }}
          />
          <FieldDefinitionTranslationAction
            context={{ entityId: 'example:record', definition: { key: 'priority', kind: 'text' } }}
          />
        </>,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Translate Preferred customer', exact: true }))
      expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
        'Select one organization in the organization switcher to translate this dictionary entry.',
      )
      expect(mockTranslationManager).not.toHaveBeenCalled()

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      fireEvent.click(screen.getByRole('button', { name: 'Translate field', exact: true }))
      expect(mockTranslationManager).toHaveBeenLastCalledWith(expect.objectContaining({
        entityType: 'entities:custom_field_def',
      }))
    } finally {
      document.cookie = 'om_selected_org=; Max-Age=0; path=/'
    }
  })

  it('maps field descriptions and option labels to their existing translation keys', () => {
    render(
      <FieldDefinitionTranslationAction
        context={{
          entityId: 'customers:customer_person',
          definition: {
            key: 'buying_role',
            kind: 'select',
            configJson: {
              label: 'Buying role',
              description: 'Role in the buying team',
              options: [
                { value: 'champion', label: 'Champion' },
                { value: 'approver', label: 'Approver' },
              ],
            },
          },
        }}
      />,
    )

    expect(mockTranslationManager).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Translate field' }))

    expect(screen.getByRole('dialog', { name: 'Translate field: buying_role' })).toBeVisible()
    expect(mockTranslationManager).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: 'embedded',
      compact: true,
      entityType: 'entities:custom_field_def',
      recordId: 'customers:customer_person:buying_role',
      translatableFields: ['label', 'description', 'options.champion.label', 'options.approver.label'],
      baseValues: {
        label: 'Buying role',
        description: 'Role in the buying team',
        'options.champion.label': 'Champion',
        'options.approver.label': 'Approver',
      },
    }))
  })

  it('supports legacy string options and ignores non-string field copy', () => {
    render(
      <FieldDefinitionTranslationAction
        context={{
          entityId: 'example:record',
          definition: { key: 'priority', kind: 'select', configJson: { label: 123, description: null, options: ['High', 'Low'] } },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Translate field' }))

    expect(mockTranslationManager).toHaveBeenLastCalledWith(expect.objectContaining({
      translatableFields: ['label', 'description', 'options.High.label', 'options.Low.label'],
      baseValues: { 'options.High.label': 'High', 'options.Low.label': 'Low' },
    }))
  })

  it('does not offer actions without a persisted record identity', () => {
    render(
      <>
        <DictionaryEntryTranslationAction context={{ dictionaryId: 'dictionary-one', entry: { id: '', label: 'New entry' } }} />
        <FieldDefinitionTranslationAction context={{ entityId: 'example:record', definition: { key: '', kind: 'text' } }} />
      </>,
    )

    expect(screen.queryByRole('button')).toBeNull()
  })
})
