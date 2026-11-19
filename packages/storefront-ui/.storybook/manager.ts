import { addons } from 'storybook/manager-api'
import { create } from 'storybook/theming'

addons.setConfig({
  theme: create({
    base: 'light',
    brandTitle: 'Open Mercato Storefront UI',
    brandUrl: '?path=/docs/foundations-tokens--docs',
    brandTarget: '_self',
    colorPrimary: '#0c0c0c',
    colorSecondary: '#0c0c0c',
    appBg: '#f7f7f7',
    appContentBg: '#ffffff',
    appBorderColor: '#ebebeb',
    appBorderRadius: 8,
    fontBase: 'Inter, ui-sans-serif, system-ui, sans-serif',
    fontCode: 'ui-monospace, SFMono-Regular, monospace',
    textColor: '#171717',
  }),
  sidebar: { showRoots: true },
})
