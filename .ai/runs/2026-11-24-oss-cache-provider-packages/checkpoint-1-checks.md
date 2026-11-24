# Checkpoint 1 — independent real-engine re-verification

Runner: local (no app container), Docker 29.9.2 (aarch64, ~8 GB VM), suites run sequentially by the root session after merging all child branches.

Command per package: `OM_CACHE_PROVIDER_CONTAINER_TESTS=1 jest --runInBand <container tests>` (package `test:containers` script), then default `yarn test` (Docker-free).

Results: see `checkpoint-1-container-run.log` — all 7 packages EXIT 0:
redis-protocol 19/19, valkey 32/32, redis 33/33, keydb 32/32, memcached 44/44, infinispan 44/44, ignite 50/50; unit suites all green.

`yarn build:packages` after merges: exit 0.
