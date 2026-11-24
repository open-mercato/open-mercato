import { createElement } from 'react'
import { History } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['security.sign_ins.view'],
  pageTitle: 'Sign-in activity',
  pageTitleKey: 'security.signIns.title',
  pageOrder: 4,
  icon: createElement(History, { size: 16 }),
  pageGroup: 'Security',
  pageGroupKey: 'settings.sections.security',
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Security', labelKey: 'security.label' },
    { label: 'Sign-in activity', labelKey: 'security.signIns.title' },
  ],
}
