# Decision Tree

Ask what the developer wants to achieve. Match to the correct mechanism(s).

| Goal | Mechanism(s) Required | Section |
|------|----------------------|---------|
| **Add data to another module's API response** | Response Enricher | §2 |
| **Add a field to another module's form** | Response Enricher + Field Widget + injection-table (Triad) | §12 |
| **Add a column to another module's table** | Response Enricher + Column Widget + injection-table (Triad) | §12 |
| **Add a filter to another module's table** | Filter Widget + injection-table + API Interceptor (for server filters) | §5 + §8 |
| **Add row/bulk actions to another module's table** | Row Action / Bulk Action Widget + injection-table | §6 |
| **Add a menu item to sidebar/topbar** | Menu Item Widget + injection-table | §7 |
| **Validate/block a request before it reaches an API route** | API Interceptor (before hook) | §8 |
| **Transform/enrich an API response after it returns** | API Interceptor (after hook) or Response Enricher | §8 or §2 |
| **Block/validate mutations before entity persistence** | Mutation Guard | §9 |
| **Replace or wrap a UI component** | Component Replacement | §10 |
| **React to domain events (after entity create/update/delete)** | Event Subscriber | §11 |
| **Add a tab/section to a detail page** | Widget Injection (tab kind) + injection-table | §6 |

**When multiple mechanisms are needed** (e.g., "add a column"), follow the **Triad Pattern** ([`triad-pattern.md`](triad-pattern.md)) which wires enricher → widget → injection-table as a coordinated set.

Section (§) references above map to the reference map in `SKILL.md`.
