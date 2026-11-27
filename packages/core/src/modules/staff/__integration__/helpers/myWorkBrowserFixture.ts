import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import type { Page } from '@playwright/test'

const moduleDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const packagesRoot = path.resolve(moduleDirectory, '../../../..')
const projectRoot = path.dirname(packagesRoot)
const fixtureOrigin = 'http://my-work.test'
const chromeModule = '@open-mercato/ui/backend/BackendChromeProvider'
const mockModules: Record<string, string> = {
  '#generated/entities.ids.generated': `export const E = { staff: { staff_time_entry: 'staff:staff_time_entry' } }; export const M = {};`,
  'next/navigation': `
    export const useRouter = () => ({ push() {}, replace() {}, refresh() {} });
    export const usePathname = () => '/backend/staff/time-tracking';
    export const useSearchParams = () => new URLSearchParams();
    export const useParams = () => ({});
  `,
  'next/link': `import * as React from 'react'; export default function Link(props) { return React.createElement('a', props); }`,
  '@open-mercato/shared/lib/logger': `
    const logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return logger; } };
    export const createLogger = () => logger;
  `,
  [chromeModule]: `
    const payload = { grantedFeatures: ['staff.*'] };
    export const useBackendChrome = () => ({ payload, isReady: true });
    export const useBackendChromePolicy = () => ({ state: 'ready', features: payload.grantedFeatures });
    export const useCurrentOrganization = () => null;
  `,
  '@open-mercato/shared/lib/frontend/useOrganizationScope': `export const useOrganizationScopeVersion = () => 0;`,
}

export async function buildMyWorkBrowserFixture() {
  const [bundle, stylesheet] = await Promise.all([
    build({
      stdin: {
        contents: `
          import * as React from 'react'
          import { createRoot } from 'react-dom/client'
          import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
          import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
          import { registerCoreInjectionWidgets, registerCoreInjectionTables } from '@open-mercato/shared/modules/widgets/injection-loader'
          import MyWorkPage from ${JSON.stringify(path.join(moduleDirectory, 'backend/staff/time-tracking/page.tsx'))}
          registerCoreInjectionWidgets([])
          registerCoreInjectionTables([])
          createRoot(document.getElementById('root')).render(
            <QueryClientProvider client={new QueryClient()}>
              <I18nProvider locale="en" dict={{}}><MyWorkPage /></I18nProvider>
            </QueryClientProvider>
          )
        `,
        resolveDir: projectRoot,
        loader: 'tsx',
      },
      alias: {
        '@open-mercato/core': path.join(packagesRoot, 'core/src'),
        '@open-mercato/shared': path.join(packagesRoot, 'shared/src'),
        '@open-mercato/ui': path.join(packagesRoot, 'ui/src'),
      },
      bundle: true,
      write: false,
      outfile: 'my-work-browser-fixture.js',
      platform: 'browser',
      format: 'iife',
      define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
      plugins: [{
        name: 'my-work-browser-fixture',
        setup(builder) {
          builder.onResolve({ filter: /BackendChromeProvider$|^next\/|^#generated\/|^@open-mercato\/shared\/lib\/(logger|frontend\/useOrganizationScope)$/ }, (args) => {
            const moduleId = args.path.endsWith('BackendChromeProvider') ? chromeModule : args.path
            return mockModules[moduleId] === undefined ? undefined : { path: moduleId, namespace: 'my-work-fixture' }
          })
          builder.onLoad({ filter: /.*/, namespace: 'my-work-fixture' }, (args) => ({
            contents: mockModules[args.path],
            loader: 'tsx',
            resolveDir: projectRoot,
          }))
        },
      }],
    }),
    buildStylesheet(),
  ])
  return { script: bundle.outputFiles[0].text, stylesheet }
}

async function buildStylesheet() {
  const source = await readFile(path.join(projectRoot, 'apps/mercato/src/app/globals.css'), 'utf8')
  const stylesheet = source
    .replace('@import "tailwindcss";', '@import "tailwindcss" source(none);')
    .replace('@import "../../.mercato/generated/module-package-sources.css";', '')
    .replace(/@source .*?;/g, '')
  const result = await postcss([tailwindcss({ base: projectRoot })]).process(
    `${stylesheet}\n@source "${path.join(packagesRoot, 'ui/src')}";\n@source "${moduleDirectory}";`,
    { from: path.join(projectRoot, 'my-work-fixture.css') },
  )
  return result.css
}

export async function mountMyWorkBrowserFixture(
  page: Page,
  fixture: Awaited<ReturnType<typeof buildMyWorkBrowserFixture>>,
  width: number,
  entryCount = 1,
) {
  const projectId = randomUUID()
  const taskId = randomUUID()
  const entries = Array.from({ length: entryCount }, () => ({
    id: randomUUID(),
    date: '2026-11-19',
    taskId,
    taskTitle: 'Review implementation',
    timeProjectId: projectId,
    projectName: 'Mobile layout regression',
    description: 'Verify the entries card',
    startedAt: '2026-11-19T09:00:00Z',
    endedAt: '2026-11-19T10:30:00Z',
    durationMinutes: 90,
    isBillable: true,
    isLocked: false,
  }))
  const payload = {
    staffMember: { id: randomUUID(), displayName: 'Layout fixture' },
    today: '2026-11-19',
    kpis: {
      todayMinutes: 90 * entryCount, weekMinutes: 90 * entryCount, monthMinutes: 90 * entryCount,
      monthNonBillableMinutes: 0, dailyTargetMinutes: 480, weekTargetMinutes: 2400,
      monthTargetMinutes: 9600, weekWorkingDays: 5, monthWorkingDays: 20, nonBillableSharePercent: 0,
    },
    entries,
    projects: [{
      id: projectId, name: 'Mobile layout regression', code: 'MOB', color: null,
      customerName: 'Fixture customer', myMinutes: 90 * entryCount, totalMinutes: 90 * entryCount, budget: null,
    }],
    recentTasks: [],
  }
  await page.setViewportSize({ width, height: 844 })
  await page.route(`${fixtureOrigin}/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><main style="padding:16px"><div id="root"></div></main>' })
    } else {
      const result = pathname.endsWith('/my-work') ? payload : { items: [] }
      await route.fulfill({ json: result })
    }
  })
  await page.goto(fixtureOrigin)
  await page.addStyleTag({ content: fixture.stylesheet })
  await page.addScriptTag({ content: fixture.script })
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Today’s entries', exact: true }) })
  const table = card.getByRole('table')
  const tableContainer = card.locator(':scope > div').filter({ has: page.getByRole('table') })
  return { card, table, tableContainer }
}
