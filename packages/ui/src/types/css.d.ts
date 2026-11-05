// Ambient declaration so side-effect CSS imports from third-party packages
// (e.g. `import '@mdxeditor/editor/style.css'`) type-check. Packages that consume
// @open-mercato/ui as source type-check this file's `.tsx` too, so MdxEditorImpl.tsx
// pulls this declaration into their program via a `/// <reference path>` directive.
declare module '*.css'
