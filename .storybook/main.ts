import type { StorybookConfig } from '@storybook/nextjs-vite';

import { dirname } from "path"

import { fileURLToPath } from "url"

/**
* This function is used to resolve the absolute path of a package.
* It is needed in projects that use Yarn PnP or are set up within a monorepo.
*/
function getAbsolutePath(value: string): any {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)))
}
const config: StorybookConfig = {
  "stories": [
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../packages/**/*.stories.@(js|jsx|mjs|ts|tsx)"
  ],
  "addons": [],
  "framework": getAbsolutePath('@storybook/nextjs-vite'),
  "staticDirs": [
    "../public"
  ]
};
export default config;