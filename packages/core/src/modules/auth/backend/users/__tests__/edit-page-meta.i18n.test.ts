import { metadata } from '../[id]/edit/page.meta'

describe('user edit page metadata i18n', () => {
  it('declares translation keys for the browser title and breadcrumbs', () => {
    expect(metadata.pageTitleKey).toBe('auth.users.form.title.edit')
    expect(metadata.breadcrumb).toEqual([
      { label: 'Users', labelKey: 'auth.nav.users', href: '/backend/users' },
      { label: 'Edit', labelKey: 'common.edit' },
    ])
  })
})
