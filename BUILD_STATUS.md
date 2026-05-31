# Build Status — v0.2.0

## Sprint Results

### Sprint 1 — Build & Baseline
- **`npm run build`**: PASS (zero TypeScript errors)
- **`npm test`**: 319 passed, 27 failed (pre-existing DB/Redis integration failures — require live Postgres + Redis)
- **TypeScript fixes applied:**
  - Added missing types to `mcp.types.ts`: `MCPServerRegistry`, `MCPServerRegistryEntry`, `MCPServerCategory`, `MCPOrchestrationError`, `JWTPayload`
  - Fixed unused import/variable errors across `mcp-client.service.ts`, `mcp-orchestrator.service.ts`, `invocation-tracker.service.ts`, `payment/refund.service.ts`, `payment/x402-payment.service.ts`
  - Fixed `return res.status()` in `Promise<void>` handlers (TS2322) across `mcp.controller.ts`
  - Rewired `app.ts` error middleware to use existing `errorHandler` function
  - Installed missing packages: `morgan`, `uuid`, `@types/morgan`

### Sprint 2 — Gateway Core
All 4 endpoints implemented in `src/gateway/` (in-memory, no DB required):

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/gateway/agents` | None | Register agent → `{ agent_id, api_key }` |
| `GET /api/gateway/capabilities?query=` | X-Agent-Key | Discover capabilities by substring |
| `POST /api/gateway/sessions` | X-Agent-Key | Create session → `{ session_id, status: "pending" }` |
| `POST /api/gateway/sessions/:id/execute` | X-Agent-Key | Execute → `{ output, cost, session_id }` |

### Sprint 3 — MCP Protocol Adapter
- `POST /mcp/invoke` implemented in `src/gateway/mcp.adapter.ts`
- Accepts `MCPToolCall { type, tool, input, agent_key }`
- Returns `MCPToolResult { type, output, cost, session_id, error? }`
- No SDK required — protocol types implemented manually

### Tests
- **15 new gateway tests** in `tests/unit/gateway/gateway.test.ts` — all PASS
- Test names matching spec: `test_agent_registration`, `test_capability_discovery`, `test_execute_session`, `test_auth_missing_key`, `simulate_mcp_tool_call`

## Required Environment Variables

| Variable | Description | Default |
|---|---|---|
| `NODE_ENV` | Runtime environment | `development` |
| `API_PORT` | HTTP listen port | `18500` |
| `DATABASE_URL` | PostgreSQL connection string | required for DB features |
| `REDIS_URL` | Redis connection string | required for rate limiting |
| `JWT_SECRET` | JWT signing secret | required for auth routes |
| `JWT_REFRESH_SECRET` | JWT refresh signing secret | required |
| `X402_WALLET_ADDRESS` | x402 payment wallet | optional |
| `X402_PRIVATE_KEY` | x402 payment private key | optional |
| `POLYGON_REFUND_WALLET_ADDRESS` | Refund wallet address | optional |

See `.env.example` for full list.

## Known Pre-existing Failures (not regressions)
- `tests/integration/user.repository.test.ts` — requires live Postgres
- `tests/integration/mcpServer.repository.test.ts` — requires live Postgres
- `tests/integration/marketplace.integration.test.ts` — requires live Postgres + Redis
