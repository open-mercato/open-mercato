import { defineConfig } from '@playwright/test'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../../..')
export default defineConfig({
  testDir: path.join(projectRoot, 'packages/core/src/modules/eudr/__integration__'),
  testMatch: 'TC-EUDR-020.spec.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  use: { baseURL: process.env.BASE_URL, headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  reporter: [['list'], ['json', { outputFile: path.join(__dirname, 'browser-results.json') }]],
  outputDir: path.join(__dirname, 'browser-artifacts'),
})
