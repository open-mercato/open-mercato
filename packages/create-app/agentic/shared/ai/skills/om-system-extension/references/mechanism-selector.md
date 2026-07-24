# Extension Mechanism Selector

Load this reference before choosing files.

| Requirement | Smallest mechanism |
|---|---|
| Add computed/list/detail fields | Response enricher; add a widget only when UI is also needed. |
| Enrich query-engine reads | Enricher with `queryEngine.enabled`; preserve `*.querying`/`*.queried` lifecycle contracts. |
| Validate/rewrite host request or add response data | API interceptor. |
| Block/rewrite host mutation with post-success work | Mutation guard contract. |
| Add form/table/menu/page content | Headless/rendered widget injection. |
| Filter a client widget reaction | Widget `eventHandlers.filter.operations`. |
| Persist app-owned data against host record | Extension entity with scalar host ID. |
| React synchronously or asynchronously | Typed subscriber; use `metadata.sync`/`priority` only for in-pipeline lifecycle work. |
| React to a browser event | Reactive notification handler, or `clientBroadcast` plus `useAppEvent`/`useOperationProgress`. |
| Add provider setup/status/detail UI | Typed integration definition plus integration wizard/status/detail widget injection. |
| Add vector, embedded AI, or provider/domain behavior | `vector.ts`, `<AiChat>`, or the typed payment/shipping/currency/workflow registry; add the owning specialist skill. |
| Adjust component behavior | Props transform, wrapper, then replacement. |
| Hide/replace supported route/page/agent/tool/etc. | `src/modules.ts` unified override. |
| Change unsupported internals | Eject only after explicit approval. |

Resolve exact host tokens from facts/source. If multiple mechanisms are required (for example editable field = widget + enricher + interceptor), name one owner for each read/write/UI leg and test them as one round trip. Reactive notifications, messages/inbox, query/vector, integrations, and AI/workflow work also select their owning task route; UMES does not replace that specialist context.
