// In a standalone app the generator writes the file-agent manifest into the
// app's `.mercato/generated/` (the enterprise module itself lives under
// `node_modules/`, which `yarn install` rewrites). The `@/` alias only exists
// inside the consuming app's bundler, so declare the module here the same way
// `ai-assistant` declares its own generated registries.
//
// Typed as `unknown[]` on purpose: the real shape is
// `FileAgentDescriptor[]` from `../../generated/file-agents.generated`, and the
// loader narrows it there. Importing that type into an ambient declaration would
// couple this file to the committed monorepo manifest, which is exactly the
// artifact a standalone app does not have.
declare module '@/.mercato/generated/file-agents.generated' {
  export const fileAgentDescriptors: unknown[]
}
