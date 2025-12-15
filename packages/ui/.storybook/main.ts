import { StorybookConfig } from '@storybook/react-webpack5'
import path from 'path'

const config: StorybookConfig = {
    stories: ['../src/**/*.stories.@(js|jsx|ts|tsx|mdx)'],

    addons: [
        '@storybook/addon-essentials',
        '@storybook/addon-a11y',
        'storybook-dark-mode',
        {
            name: '@storybook/addon-postcss',
            options: {
                postcssLoaderOptions: {
                    implementation: require('postcss'),
                },
            },
        },
    ],

    framework: {
        name: '@storybook/react-webpack5',
        options: {},
    },

    webpackFinal: async (config) => {
        // Handle path aliases
        if (config.resolve) {
            config.resolve.alias = {
                ...config.resolve.alias,
                '@': path.resolve(__dirname, '../src'),
            }
        }

        // Add TypeScript support
        config.module = config.module || {}
        config.module.rules = config.module.rules || []

        config.module.rules.push({
            test: /\.(ts|tsx)$/,
            exclude: /node_modules/,
            use: [
                {
                    loader: require.resolve('babel-loader'),
                    options: {
                        presets: [
                            require.resolve('@babel/preset-typescript'),
                            [require.resolve('@babel/preset-react'), { runtime: 'automatic' }],
                        ],
                    },
                },
            ],
        })

        return config
    },
}

export default config