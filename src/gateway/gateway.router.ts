import { Router, Request, Response, NextFunction } from 'express';
import {
  agents,
  agentsByKey,
  sessions,
  billingEvents,
  createAgent,
  createSession,
} from './store';

export const gatewayRouter = Router();

// Auth middleware — validates X-Agent-Key on protected routes
function requireAgentKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-agent-key'] as string | undefined;
  if (!key || !agentsByKey.has(key)) {
    res.status(401).json({ error: 'Missing or invalid X-Agent-Key' });
    return;
  }
  (req as unknown as Record<string, unknown>)._agentKey = key;
  next();
}

// POST /agents — register agent
gatewayRouter.post('/agents', (req: Request, res: Response): void => {
  const { name, capabilities, price_per_call } = req.body as {
    name?: string;
    capabilities?: string[];
    price_per_call?: number;
  };

  if (!name || !Array.isArray(capabilities) || typeof price_per_call !== 'number') {
    res.status(400).json({ error: 'name, capabilities (array), and price_per_call (number) are required' });
    return;
  }

  const agent = createAgent(name, capabilities, price_per_call);
  res.status(201).json({ agent_id: agent.agent_id, api_key: agent.api_key });
});

// GET /capabilities?query=<text> — discover capabilities
gatewayRouter.get('/capabilities', requireAgentKey, (req: Request, res: Response): void => {
  const query = (req.query.query as string | undefined)?.toLowerCase() ?? '';

  const results: Array<{
    agent_id: string;
    name: string;
    capability: string;
    price_per_call: number;
  }> = [];

  for (const agent of agents.values()) {
    for (const cap of agent.capabilities) {
      if (!query || cap.toLowerCase().includes(query) || agent.name.toLowerCase().includes(query)) {
        results.push({
          agent_id: agent.agent_id,
          name: agent.name,
          capability: cap,
          price_per_call: agent.price_per_call,
        });
      }
    }
  }

  res.status(200).json({ capabilities: results });
});

// POST /sessions — create commerce session
gatewayRouter.post('/sessions', requireAgentKey, (req: Request, res: Response): void => {
  const { buyer_agent, seller_agent, capability } = req.body as {
    buyer_agent?: string;
    seller_agent?: string;
    capability?: string;
  };

  if (!buyer_agent || !seller_agent || !capability) {
    res.status(400).json({ error: 'buyer_agent, seller_agent, and capability are required' });
    return;
  }

  if (!agents.has(buyer_agent)) {
    res.status(404).json({ error: `buyer_agent not found: ${buyer_agent}` });
    return;
  }
  if (!agents.has(seller_agent)) {
    res.status(404).json({ error: `seller_agent not found: ${seller_agent}` });
    return;
  }

  const session = createSession(buyer_agent, seller_agent, capability);
  res.status(201).json({ session_id: session.session_id, status: session.status });
});

// POST /sessions/:id/execute — execute session
gatewayRouter.post('/sessions/:id/execute', requireAgentKey, (req: Request, res: Response): void => {
  const session = sessions.get(req.params.id);

  if (!session) {
    res.status(404).json({ error: `Session not found: ${req.params.id}` });
    return;
  }

  const seller = agents.get(session.seller_agent);
  if (!seller) {
    res.status(404).json({ error: `Seller agent not found: ${session.seller_agent}` });
    return;
  }

  const { input } = req.body as { input?: unknown };
  const cost = seller.price_per_call;

  session.status = 'completed';
  session.output = input;
  session.cost = cost;

  billingEvents.push({
    session_id: session.session_id,
    agent_id: session.seller_agent,
    capability: session.capability,
    cost,
    timestamp: new Date(),
  });

  res.status(200).json({ output: input, cost, session_id: session.session_id });
});
