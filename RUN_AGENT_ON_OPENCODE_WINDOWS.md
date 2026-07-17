# Run an Agent on OpenCode (Agent Orchestrator) — Windows, End-to-End

Goal: run a file-defined agent from the **backoffice Playground** with **OpenCode as the
runtime**. The one-command launcher stands up everything; this guide adds only the
orchestrator-specific steps on top.

## How it connects

```
Browser Playground ─▶ Next.js app :3000 ─OPENCODE_URL─▶ OpenCode :4096 (agent runtime)
   (/backend/playground)   (orchestrator runner)              │
                                                  OPENCODE_MCP_URL + x-api-key
                                                              ▼
                                                    MCP server :3001
                                          submit_outcome / load_skill / run_skill_script
```

The app mints a per-run session token, OpenCode runs the agent and calls the MCP server's
orchestrator tools, the outcome is captured, persisted, and shown in the Playground.

---

## 1. Boot the stack (one command)

Double-click **`scripts\windows\start-windows.bat`** in the repo — or
`start-windows-rancher.bat` on Rancher Desktop machines. It installs anything missing
(Git, WSL2, a container runtime), generates `.env` secrets, prompts for an LLM provider,
builds and starts the full stack (app :3000, MCP :3001, OpenCode :4096, PostgreSQL, Redis,
Meilisearch), and prints the superadmin credentials at the end.

- The shipped example agents use **Anthropic** models — pick **Anthropic (Claude)** at the
  LLM prompt and paste your `sk-ant-...` key.
- Requirements, troubleshooting, and the full manual live in
  [`docs/manuals/windows/`](docs/manuals/windows/). On locked-down corporate machines run
  the read-only `scripts\windows\check-windows.bat` first.

> **Do NOT set `MCP_SERVER_API_KEY` yourself.** In this stack the `mcp` container
> provisions a real database-backed key into a shared volume and OpenCode reads it from
> there. A manually set value in the repo-root `.env` **shadows the provisioned key and
> breaks OpenCode → MCP auth**. (Only the legacy host-native flow — app and MCP running
> on the host against the infra-only `docker-compose.yml` — wires this key by hand; see
> the [installation docs](https://docs.openmercato.com/docs/installation/monorepo) if you
> need that setup.)

---

## 2. Enable the orchestrator (enterprise flags)

`agent_orchestrator` is an Enterprise module, OFF by default. Edit **`apps\mercato\.env`**
(created by the launcher on first run) and set **both** flags:

```ini
OM_ENABLE_ENTERPRISE_MODULES=true
OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true
```

Both are required (the second only takes effect when the first is on). They enable the
orchestrator, the bundled **`agent_examples`** module (the `deals_health_check_file` and
`support_resolution_advisor` agents this guide runs), plus `record_locks` and
`system_status_overlays`. They are app-registry flags — they do **not** go in the
repo-root `.env`.

Then restart the containers so generate + migrations + ACL sync see the module (the app
entrypoint runs them at boot):

```powershell
docker compose -f docker-compose.fullapp.dev.yml restart app mcp
docker compose -f docker-compose.fullapp.dev.yml exec app yarn mercato auth sync-role-acls
docker compose -f docker-compose.fullapp.dev.yml restart opencode
```

---

## 3. Verify the chain

```powershell
curl.exe http://localhost:3001/health           # MCP server up
curl.exe http://localhost:4096/global/health    # OpenCode up
curl.exe http://localhost:4096/mcp              # {"open-mercato":{"status":"connected"}}
```

The third must show `status: connected`. (The launcher performs the same verification at
the end of every run.) In PowerShell, `curl` is an alias — use **`curl.exe`**.

---

## 4. Run an agent from the Playground

1. Open **http://localhost:3000/backend/playground** (sidebar: **Agents → Playground**)
   signed in as the superadmin from the launcher summary (the run needs
   `agent_orchestrator.agents.run`).
2. Select a **primary** example agent — `deals_health_check_file` or
   `support_resolution_advisor`.
3. Click **Insert sample** to fill valid input JSON, then click **Run**.
4. Watch the result + trace render (informative result or an actionable proposal).

You're done — the agent ran on OpenCode.

---

## (Optional) Author your own file agent

Create `packages/<pkg>/src/modules/<module>/agents/<id>/` with `AGENT.md` + `OUTCOME.md`
(plus optional `skills/`, `sub-agents/`, `tools/`). Then re-emit and restart (no
hot-reload for agent files):

```powershell
docker compose -f docker-compose.fullapp.dev.yml exec app yarn generate
docker compose -f docker-compose.fullapp.dev.yml restart opencode
```

Keep agents **propose-only**: read-only `tools` allowlist, no `isMutation:true` tools
(rejected at load). See `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `curl.exe .../mcp` not `connected` | Remove any manually set `MCP_SERVER_API_KEY` from the repo-root `.env` (it shadows the auto-provisioned key), then `docker compose -f docker-compose.fullapp.dev.yml restart opencode`. The key also rotates on database reset — same restart fixes it |
| Playground shows no agents (or no Agents sidebar) | Both enterprise flags in `apps\mercato\.env` (Step 2), then restart `app` + `mcp` and re-check. Sign in as admin; confirm agent files under `docker/opencode/agents/` |
| `agent_orchestrator` tables missing / ACL 403 on runs | Restart the `app` container (its entrypoint migrates at boot) and run `yarn mercato auth sync-role-acls` inside it — both only see the module with the flags set |
| Agent run times out | OpenCode can't reach the model — check `ANTHROPIC_API_KEY` + `OM_AI_PROVIDER=anthropic` in the repo-root `.env`; `docker compose -f docker-compose.fullapp.dev.yml logs opencode` |
| Run errors with auth | App can't reach OpenCode — `docker compose -f docker-compose.fullapp.dev.yml ps`; `OPENCODE_URL` defaults to `http://localhost:4096` |
| Edited an agent, no change | `exec app yarn generate` then `restart opencode` (no hot-reload) |

Quick recap:

```powershell
scripts\windows\start-windows.bat            # full stack; pick Anthropic at the LLM prompt
#   apps\mercato\.env: OM_ENABLE_ENTERPRISE_MODULES=true + OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true
docker compose -f docker-compose.fullapp.dev.yml restart app mcp opencode
docker compose -f docker-compose.fullapp.dev.yml exec app yarn mercato auth sync-role-acls
#   /backend/playground → pick agent → Insert sample → Run
```
