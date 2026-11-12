# Key-rotation verification evidence

Release acceptance is in progress. The JSON files marked exploratory retain earlier measurements, including a failed final-scan throughput target; they are not final release evidence.

The standalone runner exercises actual encrypted PostgreSQL scalar/custom-document data, native encrypted backup and offline verification, real Core maintenance helpers, authenticated timestamp pages/checkpoints and a complete independent final comparison. It uses Node 24 with `--max-old-space-size=128 --max-semi-space-size=4`, a PostgreSQL 16 container limited to four CPUs/eight GiB, and an isolated disk volume. These are explicit tested runner settings; whole-app bootstrap memory is outside this component measurement.

Cold preparation stops the task-owned PostgreSQL container, evicts only clean files in its named volume with the committed `evict.c` helper, then starts fresh PostgreSQL buffers. Autovacuum is disabled only on that disposable benchmark cluster to establish a reproducible quiescent backup boundary. No host-wide cache flush or shared database is used. The matched standalone reference runs after final comparison, without timestamp-intent lookup; this warm-reference advantage is conservative and retained in the reported target result.

The separate real Core CLI test uses the actual handler, actual commercial DI registration and real MikroORM; only the app container factory is replaced by the isolated fixture. Its functional evidence must not be presented as the standalone RSS benchmark.
