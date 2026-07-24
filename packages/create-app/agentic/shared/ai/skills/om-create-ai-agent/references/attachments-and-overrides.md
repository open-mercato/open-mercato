# Attachments, Artifacts, and Overrides

Load when the agent consumes files, emits artifacts, or changes installed agents/tools.

- Validate attachment type/size/count and authorize scope/record ownership before model/tool access.
- Store through framework attachment/artifact services; encrypt sensitive metadata, use scoped/signed downloads, and define retention/cleanup.
- Keep tool results and committed traces free of raw file secrets/private transcript bodies.
- Prefer `aiAgentExtensions` for prompt/tool/suggestion changes. Extensions apply to an existing enabled agent and cannot resurrect a disabled one.
- Use full agent/tool override only for replacement/disable; keep map key equal to definition ID/name. Use `null` to disable.
- Keep extension/override exports in discovered `ai-agents.ts`/`ai-tools.ts` or supported `src/modules.ts` override domains; run generation.

Verify denied attachment access, expired download, cleanup, extension order, missing/disabled target, and stale structural-cache behavior.
