import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../../../', import.meta.url))
let script: string
let styles: string

const agents = [
  { id: 'launcher.first', label: 'Launcher First', mutationPolicy: 'read-only' },
  { id: 'launcher.second', label: 'Launcher Second', mutationPolicy: 'read-only' },
]

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { AiAssistantLauncher } from './packages/ui/src/ai/AiAssistantLauncher';
        createRoot(document.getElementById('root')).render(<AiAssistantLauncher />);`,
      loader: 'tsx',
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{
      name: 'launcher-only-fixture',
      setup(builder) {
        const mocks: Record<string, string> = {
          'next/navigation': `export const useRouter = () => ({ replace() {} });
            export const usePathname = () => '/';
            export const useSearchParams = () => new URLSearchParams();`,
          '@open-mercato/shared/lib/i18n/context': `const translate = (key, fallback) => window.launcherDictionary[key] ?? fallback ?? key;
            export const useT = () => translate;`,
          '../backend/utils/apiCall': `export const apiCall = async (url) => ({ ok: true, result:
            url.endsWith('/health') ? { healthy: true } : { aiConfigured: true, agents: ${JSON.stringify(agents)} } });`,
          './useAiAssistantAvailable': 'export const useAiAssistantAvailable = () => true;',
          './AiDock': 'export const useAiDock = () => ({ state: {}, dock() {} });',
          './AiChatSessions': `export const useAiChatSessions = () => ({ state: { sessions: [] },
            getActiveSession() { return { id: 'launcher-session', conversationId: 'launcher-conversation' }; }, ensureSession() {}, setActiveSession() {} });`,
          './ConversationShareButton': 'export const ConversationShareButton = () => null;',
          './ChatPaneTabs': 'export const ChatPaneTabs = () => null;',
          './AiChat': `import React from 'react'; export const AiChat = ({ agent }) => <div role="status">{agent}</div>;`,
        }
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (args.path in mocks) return { path: args.path, namespace: 'launcher-mock' }
          if (args.path === '@open-mercato/shared/lib/utils') {
            return { path: path.join(root, 'packages/shared/src/lib/utils.ts') }
          }
          return undefined
        })
        builder.onLoad({ filter: /.*/, namespace: 'launcher-mock' }, (args) => ({
          contents: mocks[args.path], loader: 'tsx', resolveDir: root,
        }))
      },
    }],
  })
  script = result.outputFiles[0].text
  const css = await readFile(path.join(root, 'apps/mercato/src/app/globals.css'), 'utf8')
  const fixtureCss = css
    .replace('@import "../../.mercato/generated/module-package-sources.css";', '')
    .replace(/^@source .*;$/gm, '')
  styles = (await postcss([tailwindcss({ base: root })]).process(
    `${fixtureCss}\n@source "${path.join(root, 'packages/ui/src')}";`,
    { from: path.join(root, 'launcher-fixture.css') },
  )).css
})

for (const locale of ['en', 'pl']) {
  for (const width of [320, 390, 1024]) {
    test(`launcher legend fits at ${width}px in ${locale}`, async ({ page }, testInfo) => {
      const dictionary = JSON.parse(await readFile(path.join(root,
        `packages/ai-assistant/src/modules/ai_assistant/i18n/${locale}.json`), 'utf8')) as Record<string, string>
      await page.setViewportSize({ width, height: 844 })
      await page.setContent('<html><head></head><body><div id="root"></div></body></html>')
      await page.addStyleTag({ content: styles })
      await page.evaluate((dict) => {
        Object.assign(window, { launcherDictionary: dict })
      }, dictionary)
      await page.addScriptTag({ content: script })
      await expect(page.getByRole('button', { name: dictionary['ai_assistant.launcher.triggerAriaLabel'] || 'Open AI assistant' }).first()).toBeAttached()
      await page.keyboard.press('Control+l')
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      for (const action of ['navigate', 'launch', 'close']) {
        const label = dialog.getByText(dictionary[`ai_assistant.launcher.hint.${action}`], { exact: false }).last()
        await expect(label).toBeVisible()
        const contained = await label.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          const dialogBounds = element.closest('[role="dialog"]')!.getBoundingClientRect()
          const range = document.createRange()
          range.selectNodeContents(element)
          return [...range.getClientRects()].every((rect) =>
            rect.left >= dialogBounds.left && rect.right <= dialogBounds.right &&
            rect.top >= dialogBounds.top && rect.bottom <= dialogBounds.bottom &&
            rect.left >= 0 && rect.right <= innerWidth) && bounds.width > 0
        })
        expect(contained).toBe(true)
      }
      await page.screenshot({ path: testInfo.outputPath(`launcher-${locale}-${width}.png`) })
      await dialog.getByRole('button', { name: dictionary['common.close'] || 'Close', exact: true }).click()
      await expect(dialog).toBeHidden()
      await page.keyboard.press('Control+l')
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await page.keyboard.press('Control+l')
      await expect(dialog).toBeVisible()
      await dialog.getByRole('textbox').focus()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await expect(page.getByRole('status')).toHaveText('launcher.second')
    })
  }
}
