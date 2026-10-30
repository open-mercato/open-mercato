import type { PageMetadata } from '@open-mercato/shared/modules/registry'

/**
 * No `nav` block: a detail page is reached from the list, not from the sidebar.
 * The guards are NOT optional for that reason — the catch-all is the only thing
 * standing between a deep link and the page, and a missing `page.meta.ts` makes
 * it public rather than merely unlisted.
 *
 * `portal.tasks.view`, not `.complete`: reading a task and finishing it are
 * different grants, and the page renders read-only for a principal who holds
 * only the first. The completion API enforces `.complete` independently — the
 * page guard is defence in depth, never the authorization.
 */
export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.tasks.view'],
  titleKey: 'workflows.portal.tasks.detail.title',
  title: 'Task',
}

export default metadata
