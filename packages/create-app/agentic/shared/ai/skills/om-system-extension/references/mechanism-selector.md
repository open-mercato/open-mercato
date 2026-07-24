# Extension Mechanism Selector

Load this reference before choosing files.

| Requirement | Smallest mechanism |
|---|---|
| Add computed/list/detail fields | Response enricher; add a widget only when UI is also needed. |
| Validate/rewrite host request or add response data | API interceptor. |
| Block/rewrite host mutation with post-success work | Mutation guard contract. |
| Add form/table/menu/page content | Headless/rendered widget injection. |
| Persist app-owned data against host record | Extension entity with scalar host ID. |
| React asynchronously | Typed event subscriber owned by the app module. |
| Adjust component behavior | Props transform, wrapper, then replacement. |
| Hide/replace supported route/page/agent/tool/etc. | `src/modules.ts` unified override. |
| Change unsupported internals | Eject only after explicit approval. |

Resolve exact host tokens from facts/source. If multiple mechanisms are required (for example editable field = widget + enricher + interceptor), name one owner for each read/write/UI leg and test them as one round trip.
