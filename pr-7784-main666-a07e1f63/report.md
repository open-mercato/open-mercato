# Published-head QA — PASS

PR#7784, head `e923be8bdb8e5916fb97dc8d247933be78abb0ec`, main `666ed40a1887e3076adaf49c6a75257f32d392cf`. 8 cases passed, zero skipped/retried.

| Executed case | Result |
|---|---|
| product description with fenced and tagged code blocks loads in rich-text mode | PASS |
| changing a code block language from the dropdown is saved without typing afterward | PASS |
| deleting a code block with the trash icon is saved without typing afterward | PASS |
| preserves the order header, status and details without extension placeholders | PASS |
| preserves the quote header, status and details without extension placeholders | PASS |
| mounts scoped order stage and closure contributions without document writes | PASS |
| mounts scoped quote stage and closure contributions without document writes | PASS |
| should NOT include _wms data in the quotes API response | PASS |

Fresh evidence-only OSS run on this exact published head, including main666ed40a (created-at lists, staff team assignment and shared rich-text fixes). All cases passed once, zero retries/skips; original assertions/timeouts/checks unchanged.

Real production app and disposable PostgreSQL were provisioned by the generated test-environment entrypoint. Fixtures have test-owned cleanup. The environment is stopped; no enterprise runtime exercise or human QA signoff is claimed.

The PR feature code is byte-identical across this clean main merge. Shared new-base integration was validated on082660dc with354focused core/shared/UI tests, package builds, generation and typechecks before publication. This is separate from this PR’s required current-head GitHub CI.

Three rich-text cases prove fenced/tagged code blocks load and language-change/deletion saves without additional typing. Their automatic final screenshots scrolled to unrelated panels and are omitted from the curated visual evidence; assertions are in the actual executed case list.

Four real order/quote browser cases verify native empty hosts and scoped stage/closure contributions without document writes. The quote API case proves no WMS stock enrichment. Synthetic diagnostic contributor text in screenshots is an intentional test fixture, not production copy.

Representative quote desktop/mobile contributor captures were visually inspected; long fixture text wraps and the native header/tabs/totals remain visible. Native host and order captures are included.

## Screenshots

- [order-native-document.png](order-native-document.png)
- [quote-native-document.png](quote-native-document.png)
- [order-contributors-desktop.png](order-contributors-desktop.png)
- [order-contributors-mobile.png](order-contributors-mobile.png)
- [quote-contributors-desktop.png](quote-contributors-desktop.png)
- [quote-contributors-mobile.png](quote-contributors-mobile.png)
