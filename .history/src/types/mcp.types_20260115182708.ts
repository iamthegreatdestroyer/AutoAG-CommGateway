/**
 * MCP (Model Context Protocol) Type Definitions
 * Comprehensive type system for MCP client integration, server communication,
 * tool invocation, and capability discovery.
 */

/**
 * ===========================
 * MCP Server Communication
 * ===========================
 */

/**
 * MCP Server Information
 * Represents a connected MCP server with its capabilities and metadata
 */
export interface MCPServerInfo {
  id: string;
  name: string;
  version: string;
  url: string;
  description?: string;
  capabilities: MCPCapability[];
  tools: MCPTool[];
  status: 'connected' | 'disconnected' | 'error';
  lastConnectedAt?: Date;
  connectionError?: string;
  metadata?: Record<string, any>;
}

/**
 * MCP Server Capabilities
 * Defines what features an MCP server supports
 */
export enum MCPCapabilityType {
  TOOLS = 'tools',
  RESOURCES = 'resources',
  PROMPTS = 'prompts',
  SAMPLING = 'sampling',
  LOGGING = 'logging',
  CACHING = 'caching',
}

export interface MCPCapability {
  type: MCPCapabilityType;
  supported: boolean;
  version?: string;
  features?: string[];
  configuration?: Record<string, any>;
}

/**
 * ===========================
 * Tool Definition & Invocation
 * ===========================
 */

/**
 * Tool Parameter Definition
 * Describes individual parameters for a tool
 */
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  required: boolean;
  defaultValue?: any;
  enum?: any[];
  schema?: Record<string, any>;
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
  };
}

/**
 * MCP Tool Definition
 * Represents a tool exposed by an MCP server
 */
export interface MCPTool {
  id: string;
  name: string;
  description: string;
  version?: string;
  category?: string;
  parameters: ToolParameter[];
  resultSchema?: Record<string, any>;
  rateLimit?: {
    requestsPerMinute?: number;
    requestsPerHour?: number;
    concurrent?: number;
  };
  authentication?: {
    required: boolean;
    type?: 'api_key' | 'oauth' | 'bearer';
    scopes?: string[];
  };
  examples?: ToolExample[];
  deprecated?: boolean;
  tags?: string[];
}

/**
 * Tool Example
 * Shows how to use a tool correctly
 */
export interface ToolExample {
  name: string;
  description: string;
  parameters: Record<string, any>;
  expectedResult?: Record<string, any>;
}

/**
 * ===========================
 * Tool Invocation
 * ===========================
 */

/**
 * Tool Invocation Request
 * Request to invoke a tool on an MCP server
 */
export interface ToolInvocationRequest {
  toolId: string;
  serverId: string;
  parameters: Record<string, any>;
  invokedBy: string; // User ID
  correlationId?: string; // For tracking across services
  timeout?: number; // Milliseconds
  retryConfig?: {
    maxRetries?: number;
    retryDelayMs?: number;
    backoffMultiplier?: number;
  };
  cacheConfig?: {
    cacheable: boolean;
    ttlSeconds?: number;
    cacheKey?: string;
  };
  metadata?: Record<string, any>;
}

/**
 * Tool Invocation Response
 * Response from tool execution
 */
export interface ToolInvocationResponse {
  toolId: string;
  serverId: string;
  status: 'success' | 'error' | 'timeout' | 'cancelled';
  result?: any;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
    retryable?: boolean;
  };
  executionTime: number; // Milliseconds
  cached?: boolean;
  timestamp: Date;
  correlationId?: string;
  metadata?: Record<string, any>;
}

/**
 * Batch Tool Invocation
 * Invoke multiple tools or same tool multiple times
 */
export interface BatchToolInvocation {
  id: string;
  requests: ToolInvocationRequest[];
  parallelism?: number;
  failFast?: boolean;
  metadata?: Record<string, any>;
}

/**
 * Batch Invocation Response
 * Responses from batch execution
 */
export interface BatchInvocationResponse {
  batchId: string;
  responses: ToolInvocationResponse[];
  totalTime: number;
  successCount: number;
  errorCount: number;
  failures?: Array<{
    requestIndex: number;
    error: string;
  }>;
}

/**
 * ===========================
 * Server Discovery & Registry
 * ===========================
 */

/**
 * MCP Server Discovery Result
 * Found server during discovery
 */
export interface DiscoveredMCPServer {
  name: string;
  url: string;
  description?: string;
  version?: string;
  capabilities?: MCPCapabilityType[];
  toolCount?: number;
  rating?: number;
  trustLevel?: 'verified' | 'trusted' | 'unverified';
  lastSeen?: Date;
}

/**
 * Server Connection Request
 * Parameters to establish connection to MCP server
 */
export interface ServerConnectionRequest {
  serverId?: string;
  serverName: string;
  serverUrl: string;
  authentication?: {
    type: 'none' | 'api_key' | 'bearer_token' | 'oauth';
    credentials?: Record<string, string>;
  };
  tlsVerify?: boolean;
  timeout?: number;
  metadata?: Record<string, any>;
}

/**
 * Server Connection Response
 * Result of connection attempt
 */
export interface ServerConnectionResponse {
  success: boolean;
  serverId: string;
  message: string;
  serverInfo?: MCPServerInfo;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  connectionTime: number;
}

/**
 * ===========================
 * Tool Marketplace Integration
 * ===========================
 */

/**
 * Tool Marketplace Listing
 * Tool available in marketplace
 */
export interface ToolMarketplaceListing {
  id: string;
  toolId: string;
  serverId: string;
  serverName: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  rating: number;
  reviewCount: number;
  priceModel: 'free' | 'paid' | 'freemium' | 'subscription';
  price?: {
    amount: number;
    currency: string;
    billingCycle?: 'per_use' | 'hourly' | 'daily' | 'monthly';
  };
  trustLevel: 'verified' | 'trusted' | 'unverified';
  usageStats?: {
    totalInvocations: number;
    successRate: number;
    avgExecutionTime: number;
  };
  featured?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tool Search Query
 * Search marketplace for tools
 */
export interface ToolSearchQuery {
  keyword?: string;
  category?: string;
  tags?: string[];
  minRating?: number;
  maxPrice?: number;
  trustLevel?: 'verified' | 'trusted';
  sortBy?: 'relevance' | 'rating' | 'popularity' | 'newest';
  limit?: number;
  offset?: number;
}

/**
 * ===========================
 * Monitoring & Analytics
 * ===========================
 */

/**
 * Tool Invocation Analytics
 * Track tool usage and performance
 */
export interface ToolInvocationAnalytics {
  toolId: string;
  serverId: string;
  period: 'hour' | 'day' | 'week' | 'month';
  totalInvocations: number;
  successCount: number;
  errorCount: number;
  timeoutCount: number;
  cachedCount: number;
  avgExecutionTime: number;
  minExecutionTime: number;
  maxExecutionTime: number;
  p50ExecutionTime: number;
  p95ExecutionTime: number;
  p99ExecutionTime: number;
  errorRate: number;
  cacheHitRate: number;
  topErrors?: Array<{
    errorCode: string;
    count: number;
    percentage: number;
  }>;
  invokedByUsers?: number;
  costEstimate?: number;
}

/**
 * MCP Client Event
 * Events from MCP operations for logging/monitoring
 */
export enum MCPEventType {
  SERVER_CONNECTED = 'server_connected',
  SERVER_DISCONNECTED = 'server_disconnected',
  TOOL_INVOKED = 'tool_invoked',
  TOOL_COMPLETED = 'tool_completed',
  TOOL_FAILED = 'tool_failed',
  CAPABILITY_DISCOVERED = 'capability_discovered',
  ERROR_OCCURRED = 'error_occurred',
  RATE_LIMITED = 'rate_limited',
  CACHE_HIT = 'cache_hit',
  CACHE_MISS = 'cache_miss',
}

export interface MCPClientEvent {
  type: MCPEventType;
  serverId?: string;
  toolId?: string;
  timestamp: Date;
  duration?: number;
  userId?: string;
  metadata?: Record<string, any>;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * ===========================
 * Error Types
 * ===========================
 */

/**
 * MCP-specific Error
 */
export class MCPError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 500,
    public details?: Record<string, any>,
  ) {
    super(message);
    this.name = 'MCPError';
  }
}

/**
 * Server Connection Error
 */
export class MCPServerConnectionError extends MCPError {
  constructor(serverId: string, message: string, details?: Record<string, any>) {
    super('SERVER_CONNECTION_ERROR', `Failed to connect to MCP server ${serverId}: ${message}`, 503, details);
    this.name = 'MCPServerConnectionError';
  }
}

/**
 * Tool Invocation Error
 */
export class MCPToolInvocationError extends MCPError {
  constructor(
    toolId: string,
    serverId: string,
    message: string,
    details?: Record<string, any>,
  ) {
    super(
      'TOOL_INVOCATION_ERROR',
      `Failed to invoke tool ${toolId} on server ${serverId}: ${message}`,
      500,
      details,
    );
    this.name = 'MCPToolInvocationError';
  }
}

/**
 * Tool Not Found Error
 */
export class MCPToolNotFoundError extends MCPError {
  constructor(toolId: string, serverId?: string) {
    const message = serverId ? `Tool ${toolId} not found on server ${serverId}` : `Tool ${toolId} not found`;
    super('TOOL_NOT_FOUND', message, 404);
    this.name = 'MCPToolNotFoundError';
  }
}

/**
 * Server Not Found Error
 */
export class MCPServerNotFoundError extends MCPError {
  constructor(serverId: string) {
    super('SERVER_NOT_FOUND', `MCP server ${serverId} not found`, 404);
    this.name = 'MCPServerNotFoundError';
  }
}

/**
 * Rate Limit Error
 */
export class MCPRateLimitError extends MCPError {
  constructor(
    public retryAfter: number,
    message: string = 'Rate limit exceeded',
  ) {
    super('RATE_LIMIT_EXCEEDED', message, 429);
    this.name = 'MCPRateLimitError';
  }
}

/**
 * Timeout Error
 */
export class MCPTimeoutError extends MCPError {
  constructor(toolId: string, timeout: number) {
    super(
      'TOOL_TIMEOUT',
      `Tool ${toolId} invocation timed out after ${timeout}ms`,
      504,
    );
    this.name = 'MCPTimeoutError';
  }
}
