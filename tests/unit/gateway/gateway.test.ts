/**
 * Gateway core + MCP adapter tests
 * Covers: agent registration, capability discovery, session create/execute, auth, MCP invoke
 */

import request from 'supertest';
import express from 'express';
import { gatewayRouter } from '../../../src/gateway/gateway.router';
import { mcpAdapterRouter } from '../../../src/gateway/mcp.adapter';
import { agents, agentsByKey, sessions, billingEvents } from '../../../src/gateway/store';

// Fresh app per suite — isolated from Application class (no DB/Redis deps)
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/gateway', gatewayRouter);
  app.use('/mcp', mcpAdapterRouter);
  return app;
}

// Clear in-memory state before each test
beforeEach(() => {
  agents.clear();
  agentsByKey.clear();
  sessions.clear();
  billingEvents.length = 0;
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
async function registerAgent(
  app: ReturnType<typeof buildApp>,
  name = 'TestAgent',
  capabilities = ['code-review'],
  price_per_call = 0.05
) {
  const res = await request(app)
    .post('/api/gateway/agents')
    .send({ name, capabilities, price_per_call });
  return res;
}

// ---------------------------------------------------------------------------
// test_agent_registration
// ---------------------------------------------------------------------------
describe('POST /api/gateway/agents', () => {
  it('test_agent_registration — returns 201 with agent_id and api_key', async () => {
    const app = buildApp();
    const res = await registerAgent(app, 'Coder', ['code-review', 'debug'], 0.1);

    expect(res.status).toBe(201);
    expect(res.body.agent_id).toBeDefined();
    expect(res.body.api_key).toBeDefined();
    expect(typeof res.body.agent_id).toBe('string');
    expect(typeof res.body.api_key).toBe('string');
  });

  it('returns 400 when body is incomplete', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/gateway/agents')
      .send({ name: 'Bad' }); // missing capabilities and price_per_call

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// test_capability_discovery
// ---------------------------------------------------------------------------
describe('GET /api/gateway/capabilities', () => {
  it('test_capability_discovery — query "code" returns matching agents', async () => {
    const app = buildApp();

    // Register two agents: one with "code-review", one with "translate"
    const reg = await registerAgent(app, 'CodeBot', ['code-review', 'code-gen'], 0.05);
    await registerAgent(app, 'Translator', ['translate'], 0.02);

    const res = await request(app)
      .get('/api/gateway/capabilities?query=code')
      .set('X-Agent-Key', reg.body.api_key);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.capabilities)).toBe(true);
    expect(res.body.capabilities.length).toBeGreaterThan(0);
    res.body.capabilities.forEach((c: { capability: string }) => {
      expect(c.capability.toLowerCase()).toContain('code');
    });
  });

  it('returns all capabilities when no query param given', async () => {
    const app = buildApp();
    const reg = await registerAgent(app, 'MultiBot', ['search', 'summarize'], 0.03);

    const res = await request(app)
      .get('/api/gateway/capabilities')
      .set('X-Agent-Key', reg.body.api_key);

    expect(res.status).toBe(200);
    expect(res.body.capabilities.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// test_execute_session
// ---------------------------------------------------------------------------
describe('POST /api/gateway/sessions + execute', () => {
  it('test_execute_session — output returned + cost matches price_per_call', async () => {
    const app = buildApp();

    const buyer = await registerAgent(app, 'Buyer', ['buy'], 0.01);
    const seller = await registerAgent(app, 'Seller', ['code-review'], 0.07);

    // Create session
    const sessionRes = await request(app)
      .post('/api/gateway/sessions')
      .set('X-Agent-Key', buyer.body.api_key)
      .send({
        buyer_agent: buyer.body.agent_id,
        seller_agent: seller.body.agent_id,
        capability: 'code-review',
      });

    expect(sessionRes.status).toBe(201);
    expect(sessionRes.body.session_id).toBeDefined();
    expect(sessionRes.body.status).toBe('pending');

    // Execute session
    const execRes = await request(app)
      .post(`/api/gateway/sessions/${sessionRes.body.session_id}/execute`)
      .set('X-Agent-Key', buyer.body.api_key)
      .send({ input: { code: 'function foo() {}' } });

    expect(execRes.status).toBe(200);
    expect(execRes.body.output).toEqual({ code: 'function foo() {}' });
    expect(execRes.body.cost).toBe(0.07);
    expect(execRes.body.session_id).toBe(sessionRes.body.session_id);
  });

  it('returns 404 when session not found', async () => {
    const app = buildApp();
    const reg = await registerAgent(app);

    const res = await request(app)
      .post('/api/gateway/sessions/nonexistent/execute')
      .set('X-Agent-Key', reg.body.api_key)
      .send({ input: 'x' });

    expect(res.status).toBe(404);
  });

  it('returns 404 when seller_agent does not exist', async () => {
    const app = buildApp();
    const buyer = await registerAgent(app, 'Buyer', ['buy'], 0.01);

    const res = await request(app)
      .post('/api/gateway/sessions')
      .set('X-Agent-Key', buyer.body.api_key)
      .send({
        buyer_agent: buyer.body.agent_id,
        seller_agent: 'nonexistent-id',
        capability: 'code-review',
      });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// test_auth_missing_key
// ---------------------------------------------------------------------------
describe('Auth — X-Agent-Key enforcement', () => {
  it('test_auth_missing_key — 401 on GET /capabilities without key', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/gateway/capabilities');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/X-Agent-Key/i);
  });

  it('returns 401 on POST /sessions without key', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/gateway/sessions')
      .send({ buyer_agent: 'a', seller_agent: 'b', capability: 'c' });
    expect(res.status).toBe(401);
  });

  it('returns 401 on POST /sessions/:id/execute without key', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/gateway/sessions/some-id/execute')
      .send({ input: 'x' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid key', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/gateway/capabilities')
      .set('X-Agent-Key', 'bad-key-value');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// simulate_mcp_tool_call
// ---------------------------------------------------------------------------
describe('POST /mcp/invoke', () => {
  it('simulate_mcp_tool_call — valid MCPToolResult with output + cost', async () => {
    const app = buildApp();

    // Register caller and a seller that has the "analyze" tool
    const caller = await registerAgent(app, 'Caller', ['initiate'], 0.01);
    const seller = await registerAgent(app, 'Analyzer', ['analyze'], 0.12);

    const res = await request(app)
      .post('/mcp/invoke')
      .send({
        type: 'tool_call',
        tool: 'analyze',
        input: { data: 'hello world' },
        agent_key: caller.body.api_key,
      });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('tool_result');
    expect(res.body.output).toEqual({ data: 'hello world' });
    expect(res.body.cost).toBe(0.12);
    expect(res.body.session_id).toBeDefined();
    expect(res.body.error).toBeUndefined();
  });

  it('returns 400 when MCPToolCall fields are missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/mcp/invoke')
      .send({ type: 'tool_call', tool: 'analyze' }); // no agent_key

    expect(res.status).toBe(400);
    expect(res.body.type).toBe('tool_result');
    expect(res.body.error).toBeDefined();
  });

  it('returns 401 when agent_key is unknown', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/mcp/invoke')
      .send({ type: 'tool_call', tool: 'analyze', input: {}, agent_key: 'bad' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  it('returns 404 when no seller offers the tool', async () => {
    const app = buildApp();
    const caller = await registerAgent(app, 'Caller', ['initiate'], 0.01);

    const res = await request(app)
      .post('/mcp/invoke')
      .send({
        type: 'tool_call',
        tool: 'nonexistent-tool',
        input: {},
        agent_key: caller.body.api_key,
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No agent found/);
  });
});
