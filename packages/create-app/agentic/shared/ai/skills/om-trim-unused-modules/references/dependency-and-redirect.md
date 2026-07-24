# Module Dependency and Redirect Audit

Load before disabling modules.

For each enabled module, inspect:

- declared/soft dependencies and `src/modules.ts` overrides;
- app imports, pages, widgets, events/subscribers, DI resolves, setup, CLI, workers, AI/workflows;
- provider/integration hosts and generated module facts;
- backend navigation and landing destination;
- auth, configs, entities, query index, and other bootstrap infrastructure.

Classify uncertainty as keep until resolved. When dashboards is disabled, replace its backend landing render/import with a role/ACL-aware redirect to the first enabled main destination; use `/backend/profile` only when no accessible business page exists.

After changes run generation, login/setup, backend root/sidebar/settings/profile, CLI/worker bootstrap, typecheck/build, and affected tests. Confirm no generated import still targets a disabled package/module.
