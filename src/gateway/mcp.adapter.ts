import { Router, Request, Response } from 'express';
import { agents, agentsByKey, createSession, billingEvents, AgentRecord } from './store';

export interface MCPToolCall {
  type: 'tool_call';
  tool: string;
  input: unknown;
  agent_key: string;
}

export interface MCPToolResult {
  type: 'tool_result';
  output: unknown;
  cost: number;
  session_id: string;
  error?: string;
}

export const mcpAdapterRouter = Router();

mcpAdapterRouter.post('/invoke', (req: Request, res: Response): void => {
  const body = req.body as Partial<MCPToolCall>;

  if (body.type !== 'tool_call' || !body.tool || !body.agent_key) {
    const result: MCPToolResult = {
      type: 'tool_result',
      output: null,
      cost: 0,
      session_id: '',
      error: 'Invalid MCPToolCall: type, tool, and agent_key are required',
    };
    res.status(400).json(result);
    return;
  }

  // Identify caller by agent_key
  const caller = agentsByKey.get(body.agent_key);
  if (!caller) {
    const result: MCPToolResult = {
      type: 'tool_result',
      output: null,
      cost: 0,
      session_id: '',
      error: 'Unauthorized: unknown agent_key',
    };
    res.status(401).json(result);
    return;
  }

  // Find a seller agent that exposes the requested tool/capability
  let seller: AgentRecord | undefined;
  let matchedTool: string | undefined;

  for (const agent of agents.values()) {
    if (agent.agent_id === caller.agent_id) continue;
    const cap = agent.capabilities.find(
      (c) => c.toLowerCase() === body.tool!.toLowerCase()
    );
    if (cap) {
      seller = agent;
      matchedTool = cap;
      break;
    }
  }

  if (!seller || !matchedTool) {
    const result: MCPToolResult = {
      type: 'tool_result',
      output: null,
      cost: 0,
      session_id: '',
      error: `No agent found offering tool: ${body.tool}`,
    };
    res.status(404).json(result);
    return;
  }

  // Create session
  const session = createSession(caller.agent_id, seller.agent_id, matchedTool);

  // Execute
  const cost = seller.price_per_call;
  session.status = 'completed';
  session.output = body.input;
  session.cost = cost;

  billingEvents.push({
    session_id: session.session_id,
    agent_id: seller.agent_id,
    capability: matchedTool,
    cost,
    timestamp: new Date(),
  });

  const result: MCPToolResult = {
    type: 'tool_result',
    output: body.input,
    cost,
    session_id: session.session_id,
  };

  res.status(200).json(result);
});
