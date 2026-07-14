# AutoAG-CommGateway — Phase 4 Design (tool invocation · rollback · rate limiting)

Status: **DESIGN — not yet implemented.** Authored 2026-07-14 as the turnkey spec for a
build-capable session (sigma-forge/NUC). Grounded in the current tree, not the completion docs.

> ⚠️ **Ground-truth correction.** `PHASE_4_COMPLETE.md` overclaims. The real invoke route is a
> placeholder (`src/api/routes/tools.ts:283` — *"TODO: Phase 4 – Actual tool invocation logic"*,
> returns a simulated success). Part of Phase 4 is real (the MCP client), part is stubbed (route,
> rollback), part is misdescribed (rate limiting is in-memory, not Redis). The implementer should
> correct `PHASE_4_COMPLETE.md` to match reality as the final step.

> 💰 **Phase 5 / x402 is DEFERRED** (money-path decision, 2026-07-14). Nothing here wires a real
> payment rail or moves funds. Billing is designed as an **internal ledger** against
> `User.walletBalance`, gated behind a flag, with the on-chain settlement left as an explicit
> Phase-5 hook. Simulate-before-sign stays mandatory before any real settlement is ever added.

---

## Current state (verified 2026-07-14)

| Piece | File | State |
|---|---|---|
| Invoke route `POST /tools/:id/invoke` | `src/api/routes/tools.ts:255-320` | **STUB** — simulated success, never calls the client |
| MCP client (HTTP/JSON-RPC + pool) | `src/services/mcp-client.service.ts` | **REAL** — `connect()` (:78), `invokeTool()` (:192), `callJSON_RPC()` (:429), pool `getClient`/`disconnectAll` (:665/:694) |
| Orchestrator workflow engine | `src/services/mcp-orchestrator.service.ts` | **REAL** engine + retry/backoff; `errorHandling:'rollback'` branch is a **TODO stub** (:145) |
| Rate limit — edge middleware | `src/api/middleware/rateLimit.ts` | **REAL but in-memory** (express-rate-limit), values **hardcoded**, ignores config |
| Rate limit — app service | `src/services/rate-limiter.service.ts` | **REAL but in-memory** (`Map`-based sliding window), **not Redis**, `ApiKey.rateLimit` unused |
| Redis + `RATE_LIMIT_*` config | `src/config/index.ts:51-67` | present (redis://localhost:18520, publicMax/authMax/premiumMax) but **unused by the limiters** |
| Prisma models | `prisma/schema.prisma` | `MCPServer` has **no downstream-credentials field**; `Tool` has **no rollbackTool**; `Invocation`/`Transaction`/`User.walletBalance` exist |

---

## Gap 1 — Real tool-invocation route

Wire `POST /tools/:id/invoke` to the existing MCP client: load `Tool` + its `MCPServer` → build a
`ServerConnectionRequest` (with decrypted credentials) → `MCPClientPool.getClient()` (lazy connect,
cached) → `invokeTool()` → persist an `Invocation` row → return the real result.

### Decisions (recommended)
- **D1.1 Connection model → lazy connect-on-invoke, cached in the existing pool.** The pool
  (`getClient`/`disconnectAll`) already exists; reuse it. Add idle eviction (TTL + `disconnect()`).
  *Rejected:* boot-time sync-all (wasteful, servers come/go) and a heavier pooled registry (premature).
- **D1.2 Downstream credentials → new encrypted `ServerCredential` model (1:1 with MCPServer), NOT a
  column on the hot MCPServer row.** Keeps secrets out of the frequently-read/serialized server
  record and lets them carry stricter access control. Encrypt with AES-256-GCM under a key from env/KMS
  (`MCP_CRED_KEY`), decrypt only at `connect()` time, **never log** (security rule #5).
- **D1.3 Billing coupling → internal-ledger, flag-gated, x402 deferred.** For `PAY_PER_CALL` tools:
  pre-check `User.walletBalance >= effective price` **before** dispatch (reject `402`-style if short),
  and post-hoc create a `Transaction` + decrement `walletBalance` on success. This is an **internal
  ledger only** — no real funds — behind `BILLING_ENABLED` (default **false**, so free tools work and
  paid tools 501/`FEATURE_DISABLED` until you flip it). The x402 challenge-before-dispatch path is a
  documented Phase-5 hook, not built here.

### Schema migration (D1.2)
```prisma
model ServerCredential {
  id           String   @id @default(uuid())
  serverId     String   @unique @map("server_id")
  authType     AuthType @default(NONE) @map("auth_type")
  // AES-256-GCM ciphertext (base64: iv|tag|ct). NEVER plaintext, never logged.
  secretEnc    String?  @map("secret_enc") @db.Text
  headerName   String?  @map("header_name")   // e.g. "Authorization" / "X-API-Key"
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")
  server       MCPServer @relation(fields: [serverId], references: [id], onDelete: Cascade)
  @@map("server_credentials")
}
enum AuthType { NONE API_KEY BEARER OAUTH }
```
Add `credential ServerCredential?` to `MCPServer`. `npx prisma migrate dev -n add_server_credential`.

### Route implementation sketch (`tools.ts`, replacing the :255-320 placeholder)
```
POST /tools/:id/invoke  (auth: optionalAuth today → require auth for PAY_PER_CALL)
  1. tool = prisma.tool.findUnique({id, include:{server:{include:{credential:true}}}})  // 404 if none
  2. validate req.body.input against tool.inputSchema (ajv)  → 400 on failure
  3. price = tool.pricePerCall ?? tool.server.pricePerCall ?? 0
     if price>0: require(req.user); if BILLING_ENABLED and user.walletBalance<price → 402 INSUFFICIENT_FUNDS
                 if not BILLING_ENABLED → 501 FEATURE_DISABLED
  4. inv = prisma.invocation.create({toolId, userId, inputData:input, status:'FAILURE'(interim), startTime})
  5. client = await pool.getClient(server.id) ?? await pool.connect(buildConnReq(server, decrypt(cred)))
  6. resp = await client.invokeTool({toolId, name:tool.name, parameters:input, timeout})
  7. persist: inv.update({status:SUCCESS/FAILURE/TIMEOUT, outputData, endTime, durationMs, errorMessage})
     billing (if price>0 && BILLING_ENABLED && SUCCESS): tx=Transaction.create(PAYMENT, price, platformFee=price*commissionRate, netAmount); user.walletBalance -= price; inv.transactionId=tx.id  — all in one prisma.$transaction
  8. return 200 {invocationId, status, output, durationMs, cost} | mapped 4xx/5xx
```
`buildConnReq`/`decrypt` live in a new `src/services/credential.service.ts`. Match the existing
`ServerConnectionRequest`/`ToolInvocationRequest`/`ToolInvocationResponse` types in `src/types`.

### Files: `tools.ts` (route), new `credential.service.ts`, `mcp-client.service.ts` (reuse), `schema.prisma` (+migration), `config/index.ts` (`MCP_CRED_KEY`, `BILLING_ENABLED`).
### Tests: unit — ajv reject; free-tool happy path (mocked client); paid-tool balance pre-check (both flag states); client-error → Invocation FAILURE + no ledger mutation.

---

## Gap 2 — Orchestrator rollback (saga / compensation)

`executeWorkflow` runs steps with real retry, but the `rollback` branch is `// TODO` (:145) and
`OrchestrationStep` has nothing to undo with.

### Decisions (recommended)
- **D2.1 Semantics → saga / compensation** (invoke undo tools), not log-only and not no-op. The engine
  already tracks `executedSteps`; compensation is the natural completion.
- **D2.2 How compensations are declared → per-step `compensation` on `OrchestrationStep` (in the
  request), NOT a `Tool.rollbackTool` schema column.** Compensation is workflow-specific (same tool,
  different undo depending on context) and this needs **no migration**. Optional per step.
- **D2.3 Partial-failure → record, don't throw; synchronous.** Compensate in **reverse order** over
  `executedSteps`, best-effort; collect a `rollbackResults` map; never let a failed compensation abort
  the rest. Return synchronously (the caller already `await`s `executeWorkflow`, so it gets the full
  picture) and set a precise terminal status. Emit a structured warn/alert per failed compensation.

### Type + result changes
```ts
interface OrchestrationStep { /* … */ compensation?: { serverId: string; toolId: string; parameters?: Record<string,any> } }
interface OrchestrationResult {
  status: 'success'|'partial'|'failed'|'rolled_back'|'rollback_failed';
  rollbackResults?: Map<string, { ok: boolean; error?: string }>;
  /* … existing … */
}
```

### Replace the `else if (errorHandling === 'rollback')` stub with:
```
result.status = 'partial'
const comp = await this.compensate(result)   // reverse executedSteps, invoke step.compensation via executeStep-style call, best-effort
result.rollbackResults = comp.results
result.status = comp.allOk ? 'rolled_back' : 'rollback_failed'
break
```
`compensate()` reuses the MCP client the same way `executeStep` does; a step with no `compensation`
is skipped (logged). Fully unit-testable with a mocked client — **no Redis/DB/network needed**, so
this gap can even be verified with a targeted `jest` run rather than the full suite.

### Files: `mcp-orchestrator.service.ts` (+ its test). No schema change.

---

## Gap 3 — Rate limiting: Redis-back + consolidate + policy

Two in-memory limiters today; the Redis + `RATE_LIMIT_*` config exists but is unused, and
`ApiKey.rateLimit` is dead.

### Decisions (recommended)
- **D3.1 Keep BOTH, with cleanly separated scopes** (don't merge):
  - **Edge** (`rateLimit.ts` middleware): coarse abuse/DoS limits at the HTTP boundary. Read config
    (`publicMax`/`authMax`) instead of hardcoded values.
  - **App** (`RateLimiterService`): fine per-tool / per-server / **per-API-key** quotas at invocation
    time. Wire `ApiKey.rateLimit` as the per-key ceiling and `config.rateLimit.premiumMax` for premium.
- **D3.2 Back both with Redis** (already at `redis://localhost:18520`): edge via `rate-limit-redis`
  store for express-rate-limit; app via `ioredis` sorted-set sliding window (replaces the in-memory
  `Map`, same algorithm). Makes limits correct across multiple instances/workers.
- **D3.3 Authoritative dimension order:** per-**API-key** (if present) → per-**user** (if authed) →
  per-**IP** (anonymous). Plus per-tool and per-server quotas at the app layer.
- **D3.4 Fail mode — SPLIT (⚠️ needs your sign-off):** **fail-OPEN** for the app-layer quota limiter
  (a paid API shouldn't hard-down on a Redis blip — availability > strict quota), but **fail-CLOSED**
  for the **auth-endpoint** edge limiter, falling back to the per-instance in-memory limiter so
  brute-force protection never evaporates on a Redis outage. This is the security-conscious default.

### Files: `rateLimit.ts`, `rate-limiter.service.ts`, `config/index.ts` (already has the values); add `ioredis` + `rate-limit-redis` deps. Tests: per-key ceiling from `ApiKey.rateLimit`; fail-open vs fail-closed with Redis stubbed down.

---

## OPEN — still needs your sign-off before build
1. **D3.4 fail-open (app quota) vs fail-closed (auth)** — confirm the split, or force one policy.
2. **D1.3 `BILLING_ENABLED` default** — recommend `false` (paid tools return 501 until you flip it),
   so this stays clear of the money-path deferral. Confirm.
3. **Credential encryption key custody (`MCP_CRED_KEY`)** — env var vs a KMS/Sigma Rust signer. Env is
   simplest for now (0600, never committed); flag if you want KMS from the start.

## Sequencing (on the NUC)
1. Gap 2 (rollback) — smallest, no schema/Redis, unit-testable in isolation → land first.
2. Gap 1 (invoke + `ServerCredential` migration + billing flag) → the headline feature.
3. Gap 3 (Redis rate limiting) → needs Redis up (compose already defines it).
4. Correct `PHASE_4_COMPLETE.md` to match reality; run `jest` (targeted, not the full box-hostile suite).

## Explicitly out of scope (deferred)
Phase 5 x402 chain settlement, key custody for on-chain payout, real fund movement — all remain
scaffolding per the 2026-07-14 money-path decision. This design only adds the internal-ledger hook
points they will later attach to.
