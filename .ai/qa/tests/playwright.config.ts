import { defineConfig } from '@playwright/test';
import path from 'node:path';
import {
  discoverIntegrationSpecFiles,
  filterIntegrationSpecsByModules,
} from '../../../packages/cli/src/lib/testing/integration-discovery';

const captureScreenshots = process.env.PW_CAPTURE_SCREENSHOTS === '1';
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const projectRoot = path.resolve(__dirname, '..', '..', '..');
const qaTestResultsRoot = path.join(projectRoot, '.ai', 'qa', 'test-results');
const normalizePath = (value: string) => value.split(path.sep).join('/');
const STATIC_TEST_IGNORES = [
  `${normalizePath(path.join(projectRoot, '.claude'))}/**`,
  `${normalizePath(path.join(projectRoot, '.codex'))}/**`,
  // Exclude stale worktrees used by auto-create-pr / auto-continue-pr /
  // auto-review-pr. Their source trees live under `.ai/tmp/` with their
  // own `__integration__/` folders; the Playwright discovery would
  // otherwise pick those up and run them against the current dev server,
  // which produces thousands of false failures.
  `${normalizePath(path.join(projectRoot, '.ai', 'tmp'))}/**`,
  // The create-app template ships specs that mirror apps/mercato/example.
  // They are designed to run against a freshly scaffolded standalone app
  // via `yarn test:create-app:integration`. Running them here against the
  // monorepo's apps/mercato dev server duplicates the apps/mercato suite
  // and produces cascading timeouts because the dev server is already
  // serving the apps/mercato copies.
  `${normalizePath(path.join(projectRoot, 'packages', 'create-app', 'template'))}/**`,
];
// `.ai/qa/tests` is retained for the shared Playwright config only.
// Executable specs must live in module-local `__integration__` folders.
const disabledLegacyIntegrationRoot = path.join(projectRoot, '.ai', 'qa', 'tests', '__legacy_disabled__');
const explicitSpecPaths = process.env.OM_INTEGRATION_SPEC_PATHS
  ?.split(path.delimiter)
  .map((value) => value.trim())
  .filter(Boolean);
const discoveredSpecs = discoverIntegrationSpecFiles(projectRoot, disabledLegacyIntegrationRoot);

// Affected-only: when OM_INTEGRATION_MODULES is set, restrict to those modules.
// A spec is included if its moduleName is in the set, or any of its requiredModules is.
// Specs with moduleName === null are always included.
const affectedModules = process.env.OM_INTEGRATION_MODULES
  ?.split(',')
  .map((moduleId) => moduleId.trim())
  .filter(Boolean) ?? [];
const filteredSpecs = filterIntegrationSpecsByModules(discoveredSpecs, affectedModules);
const eligibleSpecPaths = new Set(filteredSpecs.map((entry) => normalizePath(entry.path)));
const filteredSpecPaths = explicitSpecPaths
  ? affectedModules.length > 0
    ? explicitSpecPaths.filter((specPath) => {
        const relativePath = path.relative(projectRoot, path.resolve(projectRoot, specPath));
        return eligibleSpecPaths.has(normalizePath(relativePath));
      })
    : explicitSpecPaths
  : filteredSpecs.map((entry) => entry.path);

export default defineConfig({
  testDir: projectRoot,
  testMatch: filteredSpecPaths.length > 0 ? filteredSpecPaths : ['.ai/qa/tests/__no_tests__/*.spec.ts'],
  testIgnore: [
    ...STATIC_TEST_IGNORES,
  ],
  timeout: 20_000,
  expect: {
    timeout: 20_000,
  },
  retries: 1,
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    headless: true,
    screenshot: captureScreenshots ? 'on' : 'only-on-failure',
    trace: 'on-first-retry',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] }
      : undefined,
  },
  reporter: isGitHubActions
    ? [
        ['github'],
        ['list'],
        ['json', { outputFile: path.join(qaTestResultsRoot, 'results.json') }],
        ['html', { outputFolder: path.join(qaTestResultsRoot, 'html'), open: 'never' }],
      ]
    : [
        ['list'],
        ['json', { outputFile: path.join(qaTestResultsRoot, 'results.json') }],
        ['html', { outputFolder: path.join(qaTestResultsRoot, 'html'), open: 'never' }],
      ],
  outputDir: path.join(qaTestResultsRoot, 'artifacts'),
});
