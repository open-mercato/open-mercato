# Framework Context Resolver Procedure

Load this reference on every context-resolution run.

1. Start from the app root and choose exactly one module or package plus a narrow implementation question.
2. Run `yarn framework:context --module <id> --query <term>` or `--package <name>`; do not manually scan all dependencies first.
3. Confirm resolution follows `src/modules.ts` and Node package resolution from the app root, not an arbitrary hoisted duplicate.
4. Compare reported installed version with the generated module fact stamp.
5. Read the reported chain: app root for writable/safety rules, compatibility snapshot for frozen IDs, nearest package/module guide for implementation, facts for discovered surfaces.
6. Search only the emitted package/module root with its bounded `rg --no-ignore --hidden` command.
7. Report exact paths/version/files read and return an app-side implementation conclusion. Never modify the reported installed files.
