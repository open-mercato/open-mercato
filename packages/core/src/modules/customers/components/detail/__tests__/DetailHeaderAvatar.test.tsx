/** @jest-environment jsdom */

import * as React from 'react'
import { act, render, screen, within } from '@testing-library/react'
import { z } from 'zod'
import {
  ComponentReplacementHandles,
  getComponentEntry,
} from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentOverrideProvider } from '@open-mercato/ui/backend/injection/ComponentOverrideProvider'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { extensionPoints } from '../../../extension-points'
import {
  COMPANY_DETAIL_HEADER_AVATAR_COMPONENT_ID,
  CompanyDetailHeaderAvatar,
  PERSON_DETAIL_HEADER_AVATAR_COMPONENT_ID,
  PersonDetailHeaderAvatar,
} from '../DetailHeaderAvatar'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: { granted: [] } })),
}))

const avatarProps = z.object({ data: z.unknown(), displayName: z.string() })

const overview = {
  profile: null,
  customFields: {},
  tags: [],
  comments: [],
  activities: [],
  interactions: [],
  deals: [],
  todos: [],
}
const company = { ...overview, company: { id: 'acme', displayName: 'Acme' }, people: [] }
const person = { ...overview, person: { id: 'ada', displayName: 'Ada Lovelace' } }
const companyAvatar = <CompanyDetailHeaderAvatar data={company} displayName="Acme" />
const personAvatar = <PersonDetailHeaderAvatar data={person} displayName="Ada Lovelace" />

describe('customer detail header avatars', () => {
  it.each([
    ['companies', COMPANY_DETAIL_HEADER_AVATAR_COMPONENT_ID, extensionPoints.hosts.companyHeaderAvatar],
    ['people', PERSON_DETAIL_HEADER_AVATAR_COMPONENT_ID, extensionPoints.hosts.personHeaderAvatar],
  ] as const)('registers the declared %s avatar handle', (scope, id, host) => {
    expect(id).toBe(ComponentReplacementHandles.section(`customers.${scope}.detailHeader`, 'avatar'))
    expect(host.componentId).toBe(id)
    expect(getComponentEntry(id)?.metadata?.module).toBe('customers')
  })

  it('retains the monochrome company icon and person initials at their current sizes', () => {
    render(<ComponentOverrideProvider overrides={[]}>{companyAvatar}{personAvatar}</ComponentOverrideProvider>)

    const logo = screen.getByRole('img', { name: '' })
    expect(logo).toHaveClass('size-16', 'bg-muted')
    expect(logo.querySelector('.lucide-building-2')).toBeInTheDocument()
    const photo = screen.getByRole('img', { name: 'Ada Lovelace' })
    expect(photo).toHaveClass('size-12', 'bg-muted')
    expect(photo).toHaveTextContent('AL')
  })

  it.each([
    ['company', COMPANY_DETAIL_HEADER_AVATAR_COMPONENT_ID, companyAvatar, company, 'Acme'],
    ['person', PERSON_DETAIL_HEADER_AVATAR_COMPONENT_ID, personAvatar, person, 'Ada Lovelace'],
  ] as const)('passes the overview and display name to a %s replacement', (_kind, componentId, avatar, data, displayName) => {
    const replacement = jest.fn((_props: unknown) => <span>Custom avatar</span>)
    render(
      <ComponentOverrideProvider overrides={[{
        target: { componentId }, priority: 0, replacement, propsSchema: avatarProps,
      }]}>
        {avatar}
      </ComponentOverrideProvider>,
    )

    expect(screen.getByText('Custom avatar')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    const props = avatarProps.parse(replacement.mock.calls[0][0])
    expect(props.data).toBe(data)
    expect(props.displayName).toBe(displayName)
  })

  it('lets a wrapper render the original avatar', () => {
    render(
      <ComponentOverrideProvider overrides={[{
        target: { componentId: PERSON_DETAIL_HEADER_AVATAR_COMPONENT_ID },
        priority: 0,
        wrapper: (Original) => function WrappedAvatar(props) {
          return <div role="group" aria-label="Profile photo"><Original {...avatarProps.parse(props)} /></div>
        },
      }]}>
        {personAvatar}
      </ComponentOverrideProvider>,
    )

    const group = screen.getByRole('group', { name: 'Profile photo' })
    expect(within(group).getByRole('img', { name: 'Ada Lovelace' })).toHaveTextContent('AL')
  })

  it('falls back to the default when a replacement throws', () => {
    const replacement = jest.fn(() => { throw new Error('Photo unavailable') })
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(
        <ComponentOverrideProvider overrides={[{
          target: { componentId: PERSON_DETAIL_HEADER_AVATAR_COMPONENT_ID },
          priority: 0, replacement, propsSchema: avatarProps,
        }]}>
          {personAvatar}
        </ComponentOverrideProvider>,
      )

      expect(replacement).toHaveBeenCalled()
      expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toHaveTextContent('AL')
    } finally {
      consoleError.mockRestore()
    }
  })

  it('keeps the default when the feature check denies the override', async () => {
    const replacement = jest.fn(() => <span>Restricted photo</span>)

    await act(async () => {
      render(
        <ComponentOverrideProvider overrides={[{
          target: { componentId: PERSON_DETAIL_HEADER_AVATAR_COMPONENT_ID },
          priority: 0, features: ['crm.photos'], replacement, propsSchema: avatarProps,
        }]}>
          {personAvatar}
        </ComponentOverrideProvider>,
      )
    })

    expect(apiCall).toHaveBeenCalledWith('/api/auth/feature-check', expect.objectContaining({
      body: JSON.stringify({ features: ['crm.photos'] }),
    }))
    expect(replacement).not.toHaveBeenCalled()
    expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toHaveTextContent('AL')
  })
})
