# Backup acceptance measurements — 2026-11-12

Generated disposable fixtures only. These measurements contain no recovery identities, application keys or customer data.

## Timing and complete content checks

| Fixture/cache | Backup ms | Restore ms | Native+age backup ms | Native+age restore ms | Peak Node MiB |
|---|---:|---:|---:|---:|---:|
| 1g-warm | 1806 | 1535 | 1702 | 2369 | 171 |
| 1g-cold | 1783 | 1526 | 1663 | 2310 | 161 |
| 20g-warm | 31276 | 29321 | 33847 | 40959 | 194 |
| 20g-cold | 32248 | 30405 | 33018 | 43728 | 198 |

All four runs passed the proposed 1.3× matched native baseline plus 30 seconds, coordinator RSS ≤256 MiB, actual plain-renderer CPU ≤2%, and complete ordered source/target content comparison. The test oracle checks row count, payload bytes, ID sum and ordered MD5-of-row-MD5s for generated content; production archive authentication uses its SHA-256 trust chain and age, not this fixture oracle.

Timing fixtures contain one real table with 64 KiB repetitive text per row using EXTERNAL storage. Worker sweeps contain eight real tables and assert observed backup **and** restore concurrency equal to every requested jobs value 1–8. All 16 worker cases passed, including full restore and per-table ordered content comparisons. Peak coordinator RSS was 198.46 MiB for the 1 GiB sweep and 227.44 MiB for the 20 GiB sweep.

## Method and limits

- Docker limits: 4 vCPU / 8 GiB; PostgreSQL 16; Node 24.22.2; no Node heap flags.
- Warm timing follows seeding and a complete source fingerprint. Cold timing stops only the owned PostgreSQL container, evicts clean files only from its PGDATA volume, and starts fresh PostgreSQL shared buffers. The expected source fingerprint is saved before eviction. No global cache flush occurs.
- The matched native pg_dump+age / decrypt+pg_restore baseline follows each engine run, so it may benefit from warmer data. This is a conservative comparison.
- Repetitive content is highly compressible. These results do not establish the same timing for arbitrary entropy, arbitrary row widths or arbitrary PostgreSQL features.
- Coordinator RSS sampling: 50 ms for timing runs, 10 ms for worker sweeps. Worker reports also sample native descendants through /proc; PostgreSQL server daemons are separate services and are excluded.
- The 20 GiB jobs 1–5 sweep completed before a jobs 6 attempt refused a background quiescence boundary. Jobs 6–8 were repeated after disabling autovacuum only in this dedicated fixture. Safety checks were unchanged; the refusal is preserved in the aggregate report notes.
- The worker sweeps validate the 256 KiB stream configuration. Final 20 GiB cold timing also includes public status-summary writes and the final concurrent progress renderer. Minor CLI/status and resume-metadata additions do not change the successful streaming policy.
- Production plain progress was timed on actual backup/verify/restore events. The separate renderer replay uses 10,000 entities and 320,000 events: its worst mode, TTY, used 361.777 ms CPU, or 1.157% of the measured 20 GiB warm backup. The byte-counting sink excludes terminal device I/O.

Real PostgreSQL fault/recovery tests, actual CLI SIGKILL/prefix retention, the 705 ms 20 GiB restore-resume overhead, read-only status tests, and the final repository gate are documented in the PR verification report. Reproduction helpers are in packages/enterprise/src/modules/backups/__benchmarks__.
