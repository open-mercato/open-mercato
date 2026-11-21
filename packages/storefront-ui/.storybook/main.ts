import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StorybookConfig } from '@storybook/nextjs-vite'
import tailwindcss from '@tailwindcss/vite'
import { mergeConfig } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

// Separate from packages/ui/.storybook on purpose: this Storybook must not load the
// admin CSS, @open-mercato/ui or the app i18n. It documents the storefront package alone.
const config: StorybookConfig = {
  stories: ['./*.mdx', '../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: { name: '@storybook/nextjs-vite', options: {} },
  staticDirs: ['./public'],
  core: { disableTelemetry: true },
  typescript: { reactDocgen: false },
  async viteFinal(config) {
    return mergeConfig(config, {
      plugins: [tailwindcss()],
      resolve: { dedupe: ['react', 'react-dom'] },
      server: { fs: { allow: [root] } },
    })
  },
}

export default config
