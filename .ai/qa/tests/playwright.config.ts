import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { discoverIntegrationSpecFiles } from '../../../packages/cli/src/lib/testing/integration-discovery';

const captureScreenshots = process.env.PW_CAPTURE_SCREENSHOTS === '1';
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const projectRoot = path.resolve(__dirname, '..', '..', '..');
const qaTestResultsRoot = path.join(projectRoot, '.ai', 'qa', 'test-results');
const normalizePath = (value: string) => value.split(path.sep).join('/');
const STATIC_TEST_IGNORES = [
  `${normalizePath(path.join(projectRoot, '.claude'))}/**`,
  `${normalizePath(path.join(projectRoot, '.codex'))}/**`,
  `${normalizePath(path.join(projectRoot, '.ai', 'tmp'))}/**`,
];
const discoveredSpecs = discoverIntegrationSpecFiles(projectRoot, path.join(projectRoot, '.ai', 'qa', 'tests'));

// Affected-only: when OM_INTEGRATION_MODULES is set, restrict to those modules.
// A spec is included if its moduleName is in the set, or any of its requiredModules is.
// Specs with moduleName === null (legacy .ai/qa/tests/ root specs) are always included.
const affectedModules = process.env.OM_INTEGRATION_MODULES
    ? new Set(
          process.env.OM_INTEGRATION_MODULES.split(',')
              .map((m) => m.trim().toLowerCase())
              .filter(Boolean),
      )
    : null;

const filteredSpecs =
    affectedModules && affectedModules.size > 0
        ? discoveredSpecs.filter((spec) => {
              if (spec.moduleName === null) return true;
              if (affectedModules.has(spec.moduleName.toLowerCase())) return true;
              if (spec.requiredModules.some((m) => affectedModules.has(m.toLowerCase()))) return true;
              return false;
          })
        : discoveredSpecs;

const filteredSpecPaths = filteredSpecs.map((entry) => entry.path);

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
