import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import type { StorybookConfig } from '@storybook/nextjs-vite'
import tailwindcss from '@tailwindcss/vite'
import { mergeConfig } from 'vite'
import remarkGfm from 'remark-gfm'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const config: StorybookConfig = {
  stories: ['./*.mdx', './*.stories.tsx', './generated/*.stories.tsx'],
  addons: [
    { name: '@storybook/addon-docs', options: { mdxPluginOptions: { mdxCompileOptions: { remarkPlugins: [remarkGfm] } } } },
    '@storybook/addon-a11y',
  ],
  framework: { name: '@storybook/nextjs-vite', options: {} },
  core: { disableTelemetry: true },
  typescript: { reactDocgen: false },
  async viteFinal(config) {
    return mergeConfig(config, {
      plugins: [tailwindcss(), {
        name: 'open-mercato-workspace-source',
        enforce: 'pre',
        resolveId(source) {
          if (!source.startsWith('@open-mercato/')) return null
          const [, packageName, ...parts] = source.split('/')
          const target = path.join(root, 'packages', packageName, 'src', ...parts)
          for (const candidate of [target, `${target}.tsx`, `${target}.ts`, `${target}/index.tsx`, `${target}/index.ts`]) {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
          }
          return null
        },
      }],
      resolve: {
        dedupe: ['react', 'react-dom', '@tanstack/react-query'],
        alias: { '#generated/entities.ids.generated': path.join(root, 'packages/ui/.storybook/fixtures/entity-ids.ts') },
      },
      server: { fs: { allow: [root] } },
      build: { chunkSizeWarningLimit: 1200 },
    })
  },
}
export default config
