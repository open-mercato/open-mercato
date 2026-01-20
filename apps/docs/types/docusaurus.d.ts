declare module '@theme/Admonition' {
  import type { ComponentType, ReactNode } from 'react'

  type AdmonitionProps = {
    type?: string
    title?: ReactNode
    children?: ReactNode
  }

  const Admonition: ComponentType<AdmonitionProps>
  export default Admonition
}
