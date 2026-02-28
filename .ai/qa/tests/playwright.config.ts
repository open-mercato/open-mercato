import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { discoverIntegrationSpecFiles } from '../../../packages/cli/src/lib/testing/integration-discovery';

const captureScreenshots = process.env.PW_CAPTURE_SCREENSHOTS === '1';
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const projectRoot = path.resolve(__dirname, '..', '..', '..');
const STATIC_TEST_IGNORES = [
  '.claude/**',
  '.codex/**',
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
        ['json', { outputFile: '.ai/qa/test-results/results.json' }],
        ['html', { outputFolder: '.ai/qa/test-results/html', open: 'never' }],
      ]
    : [
        ['list'],
        ['json', { outputFile: '.ai/qa/test-results/results.json' }],
        ['html', { outputFolder: '.ai/qa/test-results/html', open: 'never' }],
      ],
  outputDir: '.ai/qa/test-results/artifacts',
});
