// Mirrors packages/core/src/global.d.ts: the canvas imports @xyflow/react's stylesheet as a
// side effect, which TypeScript needs an ambient module for.
declare module '*.css'
