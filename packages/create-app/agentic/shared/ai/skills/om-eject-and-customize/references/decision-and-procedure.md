# Eject Decision and Procedure

Load before proposing ejection.

Decision gate:

1. State the required behavior and exact installed module/version.
2. Reject with evidence each smaller option: response/UI extension, interceptor/guard, component/page/module override, optional package, upstream fix.
3. List files/module size, stable IDs, migrations, direct dependencies, optional peers, and upgrade/merge ownership that the app will assume.
4. Present rollback and ask for explicit approval.

After approval:

1. Run supported `yarn mercato eject <module>` from app root.
2. Verify source landed only under `src/modules/<module>/` and registration points to `@app`.
3. Preserve package behavior, public IDs, migrations/snapshots, scope, commands, ACL/setup, and optional-module degradation.
4. Make the requested change, run `yarn generate`, focused/integration/build tests, and record upstream version for future merges.

An ejected module must keep looking like an app-owned module. The canonical shape it has to land in — registration, migrations and snapshot, ACL/setup, and the entity/validator pair — is readable in the source-present, runtime-disabled `example` module: [`index.ts`](../../../../src/modules/example/index.ts), [`acl.ts`](../../../../src/modules/example/acl.ts), [`setup.ts`](../../../../src/modules/example/setup.ts), [`data/entities.ts`](../../../../src/modules/example/data/entities.ts), [`migrations/.snapshot-open-mercato.json`](../../../../src/modules/example/migrations/.snapshot-open-mercato.json), and the registry entry shape in [`src/modules.ts`](../../../../src/modules.ts). Resolve the exact installed file you are ejecting through `om-framework-context`; never link or copy a `node_modules` directory.
