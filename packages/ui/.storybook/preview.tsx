import { Preview } from '@storybook/react'
import React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

export const TooltipProvider = TooltipPrimitive.Provider
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

import '../src/styles/globals.css'


const preview: Preview = {
    parameters: {
        controls: {
            matchers: {
                color: /(background|color)$/i,
                date: /Date$/i,
            },
        },
    },

    decorators: [
        (Story) => (
            <I18nProvider locale={'en'} dict={{}}>
                <TooltipProvider>


                    <div className="min-h-screen bg-background p-8">
                        <Story />
                    </div>
                </TooltipProvider>
            </I18nProvider>
        ),
    ],
}

export default preview