import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'

/**
 * Example component overrides demonstrating Phase H of UMES.
 *
 * These show how to wrap or transform props of registered components
 * without forking the original code.
 */
export const components: ComponentOverride[] = [
  // Example: Wrap a component to add a dev-mode border indicator
  // (only active in development, uses wrapper mode)
  // {
  //   target: { componentId: 'example.todo-card' },
  //   priority: 10,
  //   wrapper: (Original) => {
  //     const Wrapped = (props: Record<string, unknown>) => {
  //       if (process.env.NODE_ENV !== 'development') {
  //         return <Original {...props} />
  //       }
  //       return (
  //         <div style={{ border: '1px dashed orange' }}>
  //           <Original {...props} />
  //         </div>
  //       )
  //     }
  //     Wrapped.displayName = 'ExampleDevBorderWrapper'
  //     return Wrapped
  //   },
  // },
]

export default components
