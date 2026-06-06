// Ambient declaration so side-effect CSS imports from third-party packages
// (e.g. `import '@mdxeditor/editor/style.css'`) type-check inside this package.
// The app (Next.js) provides this via next-env.d.ts; the standalone package build does not.
declare module '*.css'
