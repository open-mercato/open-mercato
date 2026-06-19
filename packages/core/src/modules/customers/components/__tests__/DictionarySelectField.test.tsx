/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import {
  CUSTOMER_DICTIONARIES_MANAGE_HREF,
  DictionarySelectField,
} from '../formConfig'

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
  DictionaryEntrySelect: ({ manageHref }: { manageHref?: string }) => (
    <a data-testid="manage-link" href={manageHref}>
      Manage
    </a>
  ),
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
  it('links customer dictionaries to the customers configuration page by default', () => {
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
      CUSTOMER_DICTIONARIES_MANAGE_HREF,
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
})
