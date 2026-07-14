# AutoAG-CommGateway — Working Notes for Claude Code

**Autonomous Agent Commerce Gateway** — a marketplace for MCP servers. The API/auth/DB/Docker
foundation (Phases 1–3) is real and running. Several advertised subsystems, however, are
**scaffolded stubs**, not finished features. Read this before assuming any of them work.

## ⚠️ Stubbed subsystems — do NOT treat as done

| Subsystem | Location | Status |
|-----------|----------|--------|
| Tool-invocation route (`POST /api/tools/:id/invoke`) | `src/api/routes/tools.ts` (~L283) | **STUB** — returns `"Tool invocation placeholder - implement in Phase 4"`; nothing is executed. **Phase 4.** |
| MCP tracking / rollback | `src/services/mcp-orchestrator.service.ts` (~L145) | **STUB** — `rollback` strategy is `// TODO: Implement rollback logic`; failures do not undo prior steps. **Phase 4.** |
| Redis rate-limiting | `src/services/rate-limiter.service.ts` | **STUB / future** — in-memory `Map` only, per-process, resets on restart, not Redis-backed. ⚠️ **Known minor DoS exposure** (bypassable across instances/restarts). **Phase 4–5.** |
| x402 chain-query / settlement | `src/services/payment/x402-payment.service.ts` (~L244, L376, L467) | **STUB** — blockchain queries, balances, and settlement are simulated/placeholder; no real Web3 or on-chain settlement. **Phase 5.** ⚠️ When built, settlement **MUST respect simulate-before-sign**. |

## Notes

- `marketplace.controller.ts` `getPublisherStats` (previously a 501) was fixed earlier — not a stub.
- "PRODUCTION READY" in the README refers only to the auth/DB/Docker foundation, not the
  subsystems above.
