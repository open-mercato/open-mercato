/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { DictionaryOptionsUnavailableError } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import {
  CUSTOMER_DICTIONARIES_MANAGE_HREF,
  DictionarySelectField,
  getCustomerDictionaryManageHref,
} from '../formConfig'
import { CUSTOMER_DICTIONARY_ORGANIZATION_REQUIRED_CODE } from '../../lib/dictionaries'

const mockEnsureCustomerDictionary = jest.fn()
let capturedFetchOptions: (() => Promise<unknown>) | undefined

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 'test-scope',
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect', () => ({
  DictionaryOptionsUnavailableError: class DictionaryOptionsUnavailableError extends Error {},
  DictionaryEntrySelect: ({
    manageHref,
    fetchOptions,
  }: {
    manageHref?: string
    fetchOptions: () => Promise<unknown>
  }) => {
    capturedFetchOptions = fetchOptions
    return (
      <a data-testid="manage-link" href={manageHref}>
        Manage
      </a>
    )
  },
}))

jest.mock('../detail/hooks/useCustomerDictionary', () => ({
  ensureCustomerDictionary: (...args: unknown[]) => mockEnsureCustomerDictionary(...args),
  invalidateCustomerDictionary: jest.fn(),
}))

jest.mock('../AddressTiles', () => ({
  CustomerAddressTiles: () => null,
}))

jest.mock('../detail/RolesSection', () => ({
  RolesSection: () => null,
}))

const labels = {
  placeholder: 'Select a job title',
  addLabel: 'Add job title',
  dialogTitle: 'Add job title',
  valueLabel: 'Value',
  valuePlaceholder: 'Value',
  labelLabel: 'Label',
  labelPlaceholder: 'Display name shown in UI',
  emptyError: 'Value is required',
  cancelLabel: 'Cancel',
  saveLabel: 'Save',
  errorLoad: 'Failed to load options',
  errorSave: 'Failed to save option',
  loadingLabel: 'Loading',
  manageTitle: 'Manage dictionary',
}

describe('DictionarySelectField', () => {
  beforeEach(() => {
    capturedFetchOptions = undefined
    mockEnsureCustomerDictionary.mockReset()
  })

  it('links customer dictionaries to their configuration section by default', () => {
    render(
      <DictionarySelectField
        kind="job-titles"
        value={undefined}
        onChange={() => {}}
        labels={labels}
        showManage
      />,
    )

    expect(screen.getByTestId('manage-link')).toHaveAttribute(
      'href',
      getCustomerDictionaryManageHref('job-titles'),
    )
  })

  it('keeps customer dictionary manage links on the customers configuration page', () => {
    render(
      <DictionarySelectField
        kind="industries"
        value={undefined}
        onChange={() => {}}
        labels={labels}
        showManage
      />,
    )

    expect(screen.getByTestId('manage-link').getAttribute('href')).toContain(
      CUSTOMER_DICTIONARIES_MANAGE_HREF,
    )
    expect(screen.getByTestId('manage-link')).toHaveAttribute(
      'href',
      getCustomerDictionaryManageHref('industries'),
    )
  })

  it('keeps explicit manage links when a caller provides one', () => {
    render(
      <DictionarySelectField
        kind="job-titles"
        value={undefined}
        onChange={() => {}}
        labels={labels}
        manageHref="/custom/manage"
        showManage
      />,
    )

    expect(screen.getByTestId('manage-link')).toHaveAttribute('href', '/custom/manage')
  })

  it('maps the coded organization-required response to an unavailable-options error', async () => {
    const responseError = Object.assign(new Error('Organization context is required'), {
      status: 400,
      code: CUSTOMER_DICTIONARY_ORGANIZATION_REQUIRED_CODE,
    })
    mockEnsureCustomerDictionary.mockRejectedValue(responseError)

    render(
      <DictionarySelectField
        kind="job-titles"
        value={undefined}
        onChange={() => {}}
        labels={labels}
      />,
    )

    await expect(capturedFetchOptions?.()).rejects.toBeInstanceOf(DictionaryOptionsUnavailableError)
  })

  it('preserves unclassified 400 failures for the normal error path', async () => {
    const responseError = Object.assign(new Error('Failed to load dictionary entries'), {
      status: 400,
    })
    mockEnsureCustomerDictionary.mockRejectedValue(responseError)

    render(
      <DictionarySelectField
        kind="job-titles"
        value={undefined}
        onChange={() => {}}
        labels={labels}
      />,
    )

    await expect(capturedFetchOptions?.()).rejects.toBe(responseError)
  })
})
