declare module '@/.mercato/generated/ai-agents.generated' {
  export const aiAgentConfigEntries: Array<{
    moduleId: string
    agents: unknown[]
    overrides?: Record<string, unknown>
    extensions?: unknown[]
  }>
  export const allAiAgents: unknown[]
  export const allAiAgentExtensions: unknown[]
  export const aiAgentExtensionEntries: Array<{
    moduleId: string
    extensions: unknown[]
  }>
  export const aiAgentOverrideEntries: Array<{
    moduleId: string
    overrides: Record<string, unknown>
  }>
}
