/**
 * page.meta.ts templates — nav + RBAC contract copied from
 * packages/core/src/modules/customers/backend/customers/people/page.meta.ts.
 */

export const listMetaTemplate = `export const metadata = {
  requireAuth: true,
  requireFeatures: ['{{featuresPrefix}}.view'],
  pageTitle: '{{moduleTitle}}',
  pageTitleKey: '{{moduleId}}.nav.title',
  pageGroup: '{{moduleTitle}}',
  pageGroupKey: '{{moduleId}}.nav.group',
  pageOrder: 100,
  icon: 'list',
  breadcrumb: [{ label: '{{moduleTitle}}', labelKey: '{{moduleId}}.nav.title' }],
}
`

export const createMetaTemplate = `export const metadata = {
  requireAuth: true,
  requireFeatures: ['{{featuresPrefix}}.create'],
  pageTitle: 'Create {{entityLower}}',
  pageTitleKey: '{{moduleId}}.create.title',
  pageGroup: '{{moduleTitle}}',
  pageGroupKey: '{{moduleId}}.nav.group',
  pageOrder: 101,
  icon: 'plus',
  breadcrumb: [
    { label: '{{moduleTitle}}', labelKey: '{{moduleId}}.nav.title', href: '/backend/{{moduleId}}' },
    { label: 'Create', labelKey: '{{moduleId}}.create.title' },
  ],
}
`

export const detailMetaTemplate = `export const metadata = {
  requireAuth: true,
  requireFeatures: ['{{featuresPrefix}}.view'],
  pageTitle: '{{entityTitle}} details',
  pageTitleKey: '{{moduleId}}.detail.title',
  pageGroup: '{{moduleTitle}}',
  pageGroupKey: '{{moduleId}}.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: '{{moduleTitle}}', labelKey: '{{moduleId}}.nav.title', href: '/backend/{{moduleId}}' },
    { label: 'Details', labelKey: '{{moduleId}}.detail.title' },
  ],
}
`
