import { randomUUID } from 'crypto';

export interface AgentRecord {
  agent_id: string;
  name: string;
  capabilities: string[];
  price_per_call: number;
  api_key: string;
  created_at: Date;
}

export interface SessionRecord {
  session_id: string;
  buyer_agent: string;
  seller_agent: string;
  capability: string;
  status: 'pending' | 'completed' | 'failed';
  created_at: Date;
  cost?: number;
  output?: unknown;
}

export interface BillingEvent {
  session_id: string;
  agent_id: string;
  capability: string;
  cost: number;
  timestamp: Date;
}

export const agents = new Map<string, AgentRecord>();
export const agentsByKey = new Map<string, AgentRecord>();
export const sessions = new Map<string, SessionRecord>();
export const billingEvents: BillingEvent[] = [];

export function createAgent(name: string, capabilities: string[], price_per_call: number): AgentRecord {
  const agent: AgentRecord = {
    agent_id: randomUUID(),
    name,
    capabilities,
    price_per_call,
    api_key: randomUUID(),
    created_at: new Date(),
  };
  agents.set(agent.agent_id, agent);
  agentsByKey.set(agent.api_key, agent);
  return agent;
}

export function findAgentByKey(key: string): AgentRecord | undefined {
  return agentsByKey.get(key);
}

export function createSession(buyer_agent: string, seller_agent: string, capability: string): SessionRecord {
  const session: SessionRecord = {
    session_id: randomUUID(),
    buyer_agent,
    seller_agent,
    capability,
    status: 'pending',
    created_at: new Date(),
  };
  sessions.set(session.session_id, session);
  return session;
}
