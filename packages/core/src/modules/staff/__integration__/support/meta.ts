export const integrationMeta = {
  description:
    'Staff helpdesk support tickets. Every spec repoints the organization-wide fallback routing rule and restores it in cleanup, so these specs must run with a single worker (the shared Playwright config sets workers: 1).',
  dependsOnModules: ['staff', 'customer_accounts', 'customers', 'dictionaries', 'attachments'],
}
