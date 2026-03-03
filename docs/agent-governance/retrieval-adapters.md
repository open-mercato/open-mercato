# Retrieval Adapters: Native vs External

## Goal
Support optional external retrieval acceleration (LightRAG, graphrag-rs) while keeping Open Mercato as canonical decision memory.

## Adapter extension points
- Service: `agentGovernanceRetrievalAdapterService`
- Contract: `ExternalRetrievalAdapter`
- Method: `retrieve(input)` returning normalized retrieval items (`kind`, `title`, `content`, `sourceRef`, `score`).

## Built-in providers
- `native`: default in-platform retrieval from `PrecedentIndex`, `WhyLinks`, and `EntityLinks`.
- `lightrag`: HTTP adapter (env-configured).
- `graphrag_rs`: HTTP adapter (env-configured).

## Configuration
- `AGENT_GOVERNANCE_RETRIEVAL_PROVIDER`: `native|lightrag|graphrag_rs`
- `AGENT_GOVERNANCE_RETRIEVAL_FALLBACK_PROVIDER`: fallback provider (default `native`)
- `AGENT_GOVERNANCE_RETRIEVAL_TIMEOUT_MS`
- `AGENT_GOVERNANCE_LIGHTRAG_URL`, `AGENT_GOVERNANCE_LIGHTRAG_PATH`, `AGENT_GOVERNANCE_LIGHTRAG_API_KEY`
- `AGENT_GOVERNANCE_GRAPHRAG_RS_URL`, `AGENT_GOVERNANCE_GRAPHRAG_RS_PATH`, `AGENT_GOVERNANCE_GRAPHRAG_RS_API_KEY`

## Benchmarking
- API: `POST /api/agent_governance/retrieval/benchmark`
- Evaluates providers on:
  - hit rate (`expectedSourceRefPrefixes` matches),
  - average latency,
  - average token/cost footprint,
  - fallback rate.
- Returns ranked providers and recommendation rationale.

## Production posture
- Canonical memory remains `agent_governance` decision telemetry + context graph.
- External adapters are read-time accelerators only.
- Write-path governance and telemetry durability remain in Open Mercato.
- If external adapters fail or degrade, system remains safe via native retrieval and governance controls.
