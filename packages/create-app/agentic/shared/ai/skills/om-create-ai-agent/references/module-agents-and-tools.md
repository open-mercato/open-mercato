# Module Agents and Tools

Load for typed in-product AI.

1. Put `ai-agents.ts`/`ai-tools.ts` at module root and export typed arrays.
2. Declare stable namespaced agent/tool IDs, module ID, label/description/prompt, allowed tools, execution mode, provider/model defaults, ACL, media, read-only/mutation posture, and loop budget.
3. Give each tool a Zod input, scoped/wildcard ACL, correct mutation flag, bounded serializable result, and no direct cross-module table access.
4. Write tools call `prepareMutation`; the execute callback dispatches a command with optimistic locking and side effects. No write occurs before approval.
5. Grant features in `acl.ts`/`setup.ts`; use page-context resolvers and UI parts only when required.
6. Run `yarn generate` and refresh structural cache when visibility/disable behavior changed.

Test provider missing, denied feature/scope, invalid tool args, loop budget/stop, approval/cancel/expire/stale version, partial failure, and actual post-approval data.
