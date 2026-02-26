import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import * as React from 'react'

/**
 * Example component overrides demonstrating Phase H of UMES.
 *
 * These show how to wrap or transform props of registered components
 * without forking the original code.
 */
export const components: ComponentOverride[] = [
  // Example 1: Wrapper mode — add a dev-mode visual indicator around the todos list
  {
    target: { componentId: 'section:example.todos-list' },
    priority: 10,
    wrapper: (Original) => {
      const Wrapped = (props: Record<string, unknown>) => {
        if (process.env.NODE_ENV !== 'development') {
          return React.createElement(Original, props)
        }
        return React.createElement(
          'div',
          {
            style: { border: '2px dashed #f97316', borderRadius: '8px', padding: '4px', position: 'relative' as const },
            'data-umes-override': 'example.todos-list-wrapper',
          },
          React.createElement(
            'span',
            {
              style: {
                position: 'absolute' as const, top: '-10px', left: '8px',
                background: '#f97316', color: 'white', fontSize: '10px',
                padding: '1px 6px', borderRadius: '4px', fontFamily: 'monospace',
              },
            },
            'UMES Wrapper',
          ),
          React.createElement(Original, props),
        )
      }
      Wrapped.displayName = 'ExampleDevBorderWrapper'
      return Wrapped
    },
  },

  // Example 2: PropsTransform mode — inject extra metadata into component props
  {
    target: { componentId: 'section:example.todos-list' },
    priority: 20,
    propsTransform: (props: Record<string, unknown>) => ({
      ...props,
      _umesMetadata: { transformedBy: 'example', transformedAt: new Date().toISOString() },
    }),
  },
]

export default components
