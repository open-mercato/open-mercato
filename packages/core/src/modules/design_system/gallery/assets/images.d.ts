declare module '*.png' {
  const image: string | { readonly src: string; readonly width: number; readonly height: number }
  export default image
}

declare module '*.svg' {
  const image: string | { readonly src: string; readonly width: number; readonly height: number }
  export default image
}
