/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { DictionaryOptionsUnavailableError } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import {
  CUSTOMER_DICTIONARIES_MANAGE_HREF,
  CompanySelectField,
  DictionarySelectField,
  createCompanyEditFields,
  createCompanyFormFields,
  createPersonFormFields,
  getCustomerDictionaryManageHref,
} from '../formConfig'
import type { CrudCustomField, CrudField } from '@open-mercato/ui/backend/CrudForm'
import { DealFormField } from '../detail/create/DealFormField'
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
    id,
    ariaLabelledBy,
    manageHref,
    fetchOptions,
  }: {
    id?: string
    ariaLabelledBy?: string
    manageHref?: string
    fetchOptions: () => Promise<unknown>
  }) => {
    capturedFetchOptions = fetchOptions
    return (
      <>
        <button type="button" role="combobox" aria-expanded={false} id={id} aria-labelledby={ariaLabelledBy} />
        <a data-testid="manage-link" href={manageHref}>
          Manage
        </a>
      </>
    )
  },
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: { items: [] } })),
  apiCallOrThrow: jest.fn(async () => ({ ok: true, result: {} })),
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
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

  it('forwards the id to the select trigger', () => {
    render(
      <DictionarySelectField
        id="status"
        kind="deal-statuses"
        value={undefined}
        onChange={() => {}}
        labels={labels}
      />,
    )

    expect(screen.getByRole('combobox')).toHaveAttribute('id', 'status')
  })

  it('names the select from the surrounding DealFormField label', () => {
    render(
      <DealFormField fieldId="status" label="Status">
        <DictionarySelectField
          kind="deal-statuses"
          value={undefined}
          onChange={() => {}}
          labels={labels}
        />
      </DealFormField>,
    )

    expect(screen.getByLabelText('Status')).toBe(screen.getByRole('combobox'))
  })
})

// The CrudForm wrapper labels a custom field with a <label id>, and passes that
// id to the field. These selects have to forward it to their trigger, or the
// combobox has no accessible name.
describe('customers form selects are named by their field label', () => {
  const t = (key: string, fallback?: string) => fallback ?? key

  function renderCustomField(fields: CrudField[], id: string) {
    const field = fields.find((entry) => entry.id === id) as CrudCustomField | undefined
    if (!field || field.type !== 'custom') throw new Error(`[internal] no custom field ${id}`)
    return render(<>{field.component({ id, value: undefined, setValue: () => {}, labelId: `label-${id}` })}</>)
  }

  it('forwards the label id from DictionarySelectField to its trigger', () => {
    render(
      <DictionarySelectField kind="job-titles" value={undefined} onChange={() => {}} labels={labels} ariaLabelledBy="label-job" />,
    )

    expect(screen.getByRole('combobox')).toHaveAttribute('aria-labelledby', 'label-job')
  })

  it.each(['jobTitle', 'status', 'lifecycleStage', 'source'])('names the person form %s select', (id) => {
    renderCustomField(createPersonFormFields(t), id)

    expect(screen.getByRole('combobox')).toHaveAttribute('aria-labelledby', `label-${id}`)
  })

  it.each(['status', 'lifecycleStage', 'source'])('names the company form %s select', (id) => {
    renderCustomField(createCompanyFormFields(t), id)

    expect(screen.getByRole('combobox')).toHaveAttribute('aria-labelledby', `label-${id}`)
  })

  it('names the company edit industry select', () => {
    renderCustomField(createCompanyEditFields(t), 'industry')

    expect(screen.getByRole('combobox')).toHaveAttribute('aria-labelledby', 'label-industry')
  })

  it('names the person form company select', async () => {
    renderCustomField(createPersonFormFields(t), 'companyEntityId')

    expect(await screen.findByRole('combobox')).toHaveAttribute('aria-labelledby', 'label-companyEntityId')
  })

  it('forwards the label id from CompanySelectField to its trigger', async () => {
    render(
      <CompanySelectField
        value={undefined}
        onChange={() => {}}
        ariaLabelledBy="label-company"
        labels={{
          placeholder: 'Select a company',
          addLabel: 'Add company',
          addPrompt: 'Enter a company',
          dialogTitle: 'Add company',
          inputLabel: 'Name',
          inputPlaceholder: 'Name',
          emptyError: 'Required',
          cancelLabel: 'Cancel',
          saveLabel: 'Save',
          errorLoad: 'Failed to load',
          errorSave: 'Failed to save',
          loadingLabel: 'Loading',
        }}
      />,
    )

    expect(await screen.findByRole('combobox')).toHaveAttribute('aria-labelledby', 'label-company')
  })
})
