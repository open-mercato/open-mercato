# Open Mercato Business Harness

Lekki runtime agentów biznesowych oparty na Vercel AI SDK. Harness nie przechowuje konfiguracji tenantów ani sekretów. Otrzymuje wersjonowany bundle z OM i wymienia grant runu na krótkotrwałe poświadczenia modelu oraz MCP lub CLI.

## Domyślne uruchomienie przez OM

```bash
HARNESS_CREDENTIAL_MODE=broker \
HARNESS_CREDENTIAL_BROKER_URL=http://127.0.0.1:3000/api/agent_orchestrator/internal/credentials/exchange \
HARNESS_CONFIG_FILE=packages/business-harness/harness.config.host.json \
yarn workspace @open-mercato/business-harness run:stdio < agent-execution-bundle.json
```

OM uruchamia ten proces automatycznie dla każdego runu. Domyślny `OM_BUSINESS_HARNESS_TRANSPORT=stdio` nie wymaga portu, service tokenu ani osobnego kontenera.

Opcjonalny wariant served HTTP:

```bash
HARNESS_SERVICE_TOKEN=local-business-harness-service-token \
HARNESS_CREDENTIAL_MODE=broker \
HARNESS_CREDENTIAL_BROKER_URL=http://127.0.0.1:3000/api/agent_orchestrator/internal/credentials/exchange \
HARNESS_CONFIG_FILE=packages/business-harness/harness.config.host.json \
yarn workspace @open-mercato/business-harness start
```

Po stronie OM ustaw wtedy `OM_BUSINESS_HARNESS_TRANSPORT=http`, `OM_BUSINESS_HARNESS_URL` i `BUSINESS_HARNESS_SERVICE_TOKEN`.

Transport narzędzi wybiera konfiguracja konektora. Zmiana `mcp-http` na `cli-stdio` nie zmienia kontraktu bundle ani definicji agentów.
