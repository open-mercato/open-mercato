import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverIntegrationSpecFiles } from '@open-mercato/cli/lib/testing/integration-discovery';

const captureScreenshots = process.env.PW_CAPTURE_SCREENSHOTS === '1';
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..', '..');
const qaTestResultsRoot = path.join(projectRoot, '.ai', 'qa', 'test-results');
const normalizePath = (value: string) => value.split(path.sep).join('/');
const STATIC_TEST_IGNORES = [
  `${normalizePath(path.join(projectRoot, '.claude'))}/**`,
  `${normalizePath(path.join(projectRoot, '.codex'))}/**`,
];
const discoveredSpecs = discoverIntegrationSpecFiles(projectRoot, path.join(projectRoot, '.ai', 'qa', 'tests'));
const discoveredSpecPaths = discoveredSpecs.map((entry) => entry.path);

export default defineConfig({
  testDir: projectRoot,
  testMatch: discoveredSpecPaths.length > 0 ? discoveredSpecPaths : ['.ai/qa/tests/__no_tests__/*.spec.ts'],
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
