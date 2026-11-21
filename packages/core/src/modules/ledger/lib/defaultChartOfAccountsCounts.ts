/**
 * Row counts of `DEFAULT_CHART_OF_ACCOUNTS_PL`, kept apart from the template
 * so the accounts page can show them in the import confirmation without
 * bundling the whole template into the client. A unit test
 * (`lib/__tests__/defaultChartOfAccounts.test.ts`) fails when these drift
 * from the template.
 */
export const DEFAULT_CHART_OF_ACCOUNTS_PL_COUNTS = {
  typeCount: 42,
  accountCount: 46,
} as const
