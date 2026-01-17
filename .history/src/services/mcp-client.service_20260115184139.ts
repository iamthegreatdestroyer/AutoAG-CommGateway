/**
 * MCP Server Client Service
 * Handles communication with MCP servers via JSON-RPC protocol
 * Manages server connections, capability discovery, and tool invocation
 */

import axios, { AxiosInstance } from 'axios';
import { Logger } from '../utils/logger';
import { RateLimiterService } from './rate-limiter.service';
import { InvocationTrackerService } from './invocation-tracker.service';
import { RollbackService } from './rollback.service';
import {
  MCPServerInfo,
  MCPCapability,
  MCPCapabilityType,
  MCPTool,
  ToolInvocationRequest,
  ToolInvocationResponse,
  ServerConnectionRequest,
  ServerConnectionResponse,
  DiscoveredMCPServer,
  MCPClientEvent,
  MCPEventType,
  MCPError,
  MCPServerConnectionError,
  MCPToolInvocationError,
  MCPTimeoutError,
} from '../types/mcp.types';

/**
 * JSON-RPC Request/Response types for MCP protocol
 */
interface JSONRPCRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, any>;
  id: string | number;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: string | number;
}

/**
 * MCP Server Client
 * Primary client for MCP server communication
 */
export class MCPServerClient {
  private client: AxiosInstance | null = null;
  private serverInfo: MCPServerInfo | null = null;
  private requestId: number = 0;
  private eventListeners: Map<MCPEventType, Function[]> = new Map();
  private logger: Logger;
  private serverUrl: string;
  private serverId: string;
  private connectionTimeout: number = 10000; // 10 seconds
  private rateLimiter: RateLimiterService;
  private invocationTracker: InvocationTrackerService;
  private rollbackService: RollbackService;

  constructor(serverUrl: string, serverId: string) {
    this.serverUrl = serverUrl;
    this.serverId = serverId;
    this.logger = Logger.getInstance();
    this.rateLimiter = RateLimiterService.getInstance();
    this.invocationTracker = InvocationTrackerService.getInstance();
    this.rollbackService = RollbackService.getInstance();
  }

  /**
   * Connect to MCP server
   * Establishes connection and discovers server capabilities
   */
  async connect(connectionRequest: ServerConnectionRequest): Promise<ServerConnectionResponse> {
    try {
      this.logger.info(
        `[MCP] Connecting to server: ${connectionRequest.serverName} (${connectionRequest.serverUrl})`
      );

      const startTime = Date.now();

      // Create axios instance with authentication
      this.client = axios.create({
        baseURL: connectionRequest.serverUrl,
        timeout: this.connectionTimeout,
        headers: this.buildHeaders(connectionRequest.authentication),
        validateStatus: () => true, // Don't throw on any status
      });

      // Verify connectivity with version request
      await this.callJSON_RPC('server_info', {});

      // Discover server capabilities
      const capabilitiesResponse = await this.callJSON_RPC('capabilities_discovery', {});

      // Discover available tools
      const toolsResponse = await this.callJSON_RPC('tools_list', {});

      const connectionTime = Date.now() - startTime;

      this.serverInfo = {
        id: this.serverId,
        name: connectionRequest.serverName,
        version: capabilitiesResponse.version || '1.0.0',
        url: connectionRequest.serverUrl,
        description: capabilitiesResponse.description,
        capabilities: this.parseCapabilities(capabilitiesResponse.capabilities),
        tools: this.parseTools(toolsResponse.tools),
        status: 'connected',
        lastConnectedAt: new Date(),
      };

      this.emitEvent(MCPEventType.SERVER_CONNECTED, {
        serverId: this.serverId,
        connectionTime,
      });

      this.logger.info(`[MCP] Successfully connected to server: ${this.serverId}`, {
        toolCount: this.serverInfo.tools.length,
        connectionTime,
      });

      return {
        success: true,
        serverId: this.serverId,
        message: `Connected to ${connectionRequest.serverName}`,
        serverInfo: this.serverInfo,
        connectionTime,
      };
    } catch (error: any) {
      const connectionError = error.message || 'Unknown connection error';

      this.logger.error(`[MCP] Failed to connect to server: ${this.serverId}`, {
        error: connectionError,
        details: error.response?.data,
      });

      this.emitEvent(MCPEventType.SERVER_DISCONNECTED, {
        serverId: this.serverId,
      });

      throw new MCPServerConnectionError(this.serverId, connectionError, {
        url: connectionRequest.serverUrl,
        originalError: error.message,
      });
    }
  }

  /**
   * Disconnect from MCP server
   */
  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.callJSON_RPC('server_shutdown', {});
      }

      this.client = null;
      this.serverInfo = null;

      this.emitEvent(MCPEventType.SERVER_DISCONNECTED, {
        serverId: this.serverId,
      });

      this.logger.info(`[MCP] Disconnected from server: ${this.serverId}`);
    } catch (error) {
      this.logger.warn(`[MCP] Error during disconnect: ${error}`);
    }
  }

  /**
   * Check if connected to server
   */
  isConnected(): boolean {
    return this.client !== null && this.serverInfo !== null;
  }

  /**
   * Get server info
   */
  getServerInfo(): MCPServerInfo | null {
    return this.serverInfo;
  }

  /**
   * Invoke a tool on the MCP server
   */
  async invokeTool(request: ToolInvocationRequest): Promise<ToolInvocationResponse> {
    if (!this.isConnected()) {
      throw new MCPServerConnectionError(this.serverId, 'Server not connected');
    }

    const startTime = Date.now();
    const correlationId = request.correlationId || this.generateCorrelationId();

    try {
      this.logger.debug(`[MCP] Invoking tool: ${request.toolId} on server: ${this.serverId}`, {
        correlationId,
        parameters: request.parameters,
      });

      // Find tool in server capabilities
      const tool = this.serverInfo!.tools.find((t) => t.id === request.toolId);
      if (!tool) {
        throw new MCPToolInvocationError(request.toolId, this.serverId, 'Tool not found on server');
      }

      // Check rate limiting
      if (tool.rateLimit) {
        await this.checkRateLimit(request.toolId);
      }

      // Invoke tool via JSON-RPC
      const result = await this.callJSON_RPC(
        'tool_call',
        {
          tool_name: request.toolId,
          parameters: request.parameters,
          correlation_id: correlationId,
        },
        request.timeout
      );

      const executionTime = Date.now() - startTime;

      this.emitEvent(MCPEventType.TOOL_COMPLETED, {
        toolId: request.toolId,
        serverId: this.serverId,
        duration: executionTime,
        userId: request.invokedBy,
      });

      const response: ToolInvocationResponse = {
        toolId: request.toolId,
        serverId: this.serverId,
        status: 'success',
        result,
        executionTime,
        timestamp: new Date(),
        correlationId,
      };

      this.logger.info(`[MCP] Tool invocation successful: ${request.toolId}`, {
        correlationId,
        executionTime,
      });

      return response;
    } catch (error: any) {
      const executionTime = Date.now() - startTime;

      // Handle timeout
      if (error.code === 'ECONNABORTED') {
        const timeoutError = new MCPTimeoutError(request.toolId, request.timeout || 30000);

        this.emitEvent(MCPEventType.TOOL_FAILED, {
          toolId: request.toolId,
          serverId: this.serverId,
          duration: executionTime,
          userId: request.invokedBy,
        });

        return {
          toolId: request.toolId,
          serverId: this.serverId,
          status: 'timeout',
          error: {
            code: 'TIMEOUT',
            message: timeoutError.message,
            retryable: true,
          },
          executionTime,
          timestamp: new Date(),
          correlationId,
        };
      }

      // Handle invocation error
      const invocationError =
        error instanceof MCPError
          ? error
          : new MCPToolInvocationError(request.toolId, this.serverId, error.message, error);

      this.emitEvent(MCPEventType.TOOL_FAILED, {
        toolId: request.toolId,
        serverId: this.serverId,
        duration: executionTime,
        userId: request.invokedBy,
      });

      this.logger.error(`[MCP] Tool invocation failed: ${request.toolId}`, {
        correlationId,
        error: invocationError.message,
        executionTime,
      });

      return {
        toolId: request.toolId,
        serverId: this.serverId,
        status: 'error',
        error: {
          code: invocationError.code,
          message: invocationError.message,
          details: invocationError.details,
          retryable: error.retryable !== false,
        },
        executionTime,
        timestamp: new Date(),
        correlationId,
      };
    }
  }

  /**
   * Discover tools available on server
   */
  async discoverTools(): Promise<MCPTool[]> {
    if (!this.isConnected()) {
      throw new MCPServerConnectionError(this.serverId, 'Server not connected');
    }

    try {
      const response = await this.callJSON_RPC('tools_list', {});
      const tools = this.parseTools(response.tools);

      this.emitEvent(MCPEventType.CAPABILITY_DISCOVERED, {
        serverId: this.serverId,
        metadata: {
          toolCount: tools.length,
        },
      });

      return tools;
    } catch (error: any) {
      this.logger.error(`[MCP] Failed to discover tools on server: ${this.serverId}`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get server capabilities
   */
  async discoverCapabilities(): Promise<MCPCapability[]> {
    if (!this.isConnected()) {
      throw new MCPServerConnectionError(this.serverId, 'Server not connected');
    }

    try {
      const response = await this.callJSON_RPC('capabilities_discovery', {});
      return this.parseCapabilities(response.capabilities);
    } catch (error: any) {
      this.logger.error(`[MCP] Failed to discover capabilities on server: ${this.serverId}`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Call JSON-RPC method on server
   */
  private async callJSON_RPC(
    method: string,
    params: Record<string, any>,
    timeout?: number
  ): Promise<any> {
    if (!this.client) {
      throw new MCPServerConnectionError(this.serverId, 'Client not initialized');
    }

    const id = ++this.requestId;
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    };

    try {
      const response = await this.client.post('/', request, {
        timeout: timeout || this.connectionTimeout,
      });

      const jsonRpcResponse: JSONRPCResponse = response.data;

      if (jsonRpcResponse.error) {
        throw new MCPError(
          'JSON_RPC_ERROR',
          jsonRpcResponse.error.message,
          500,
          jsonRpcResponse.error.data
        );
      }

      return jsonRpcResponse.result;
    } catch (error: any) {
      if (error instanceof MCPError) {
        throw error;
      }
      throw new MCPError('RPC_CALL_ERROR', `Failed to call ${method}: ${error.message}`, 500, {
        method,
        params,
      });
    }
  }

  /**
   * Build HTTP headers for authentication
   */
  private buildHeaders(authentication?: any): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'AutoAG-CommGateway/1.0',
    };

    if (authentication) {
      switch (authentication.type) {
        case 'api_key':
          headers['X-API-Key'] = authentication.credentials?.key || '';
          break;
        case 'bearer_token':
          headers['Authorization'] = `Bearer ${authentication.credentials?.token || ''}`;
          break;
        case 'oauth':
          headers['Authorization'] = `Bearer ${authentication.credentials?.accessToken || ''}`;
          break;
      }
    }

    return headers;
  }

  /**
   * Parse capabilities from server response
   */
  private parseCapabilities(capabilitiesData: any): MCPCapability[] {
    if (!capabilitiesData) {
      return [];
    }

    return Object.entries(capabilitiesData).map(([type, config]: [string, any]) => ({
      type: type as MCPCapabilityType,
      supported: config.supported !== false,
      version: config.version,
      features: config.features || [],
      configuration: config.configuration,
    }));
  }

  /**
   * Parse tools from server response
   */
  private parseTools(toolsData: any[]): MCPTool[] {
    if (!toolsData || !Array.isArray(toolsData)) {
      return [];
    }

    return toolsData.map((tool) => ({
      id: tool.name || tool.id,
      name: tool.name,
      description: tool.description,
      version: tool.version,
      category: tool.category,
      parameters: this.parseParameters(tool.inputSchema),
      resultSchema: tool.resultSchema,
      rateLimit: tool.rateLimit,
      authentication: tool.authentication,
      examples: tool.examples,
      tags: tool.tags || [],
    }));
  }

  /**
   * Parse parameters from JSON schema
   */
  private parseParameters(schema: any): any[] {
    if (!schema || schema.type !== 'object') {
      return [];
    }

    const properties = schema.properties || {};
    const required = schema.required || [];

    return Object.entries(properties).map(([name, prop]: [string, any]) => ({
      name,
      type: this.mapJSONSchemaType(prop.type),
      description: prop.description,
      required: required.includes(name),
      defaultValue: prop.default,
      enum: prop.enum,
      schema: prop,
      validation: {
        minLength: prop.minLength,
        maxLength: prop.maxLength,
        min: prop.minimum,
        max: prop.maximum,
        pattern: prop.pattern,
      },
    }));
  }

  /**
   * Map JSON schema types to TypeScript types
   */
  private mapJSONSchemaType(
    jsonType: string
  ): 'string' | 'number' | 'boolean' | 'array' | 'object' {
    const typeMap: Record<string, any> = {
      string: 'string',
      integer: 'number',
      number: 'number',
      boolean: 'boolean',
      array: 'array',
      object: 'object',
    };

    return typeMap[jsonType] || 'string';
  }

  /**
   * Check rate limit for tool
   */
  private async checkRateLimit(toolId: string): Promise<void> {
    // TODO: Implement rate limiting check with Redis
    // This will check tool-specific rate limits
  }

  /**
   * Register event listener
   */
  on(eventType: MCPEventType, listener: Function): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType)!.push(listener);
  }

  /**
   * Emit event to listeners
   */
  private emitEvent(eventType: MCPEventType, data: any): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener({
            type: eventType,
            timestamp: new Date(),
            ...data,
          } as MCPClientEvent);
        } catch (error) {
          this.logger.error(`[MCP] Error in event listener: ${error}`);
        }
      });
    }
  }

  /**
   * Generate correlation ID for tracking
   */
  private generateCorrelationId(): string {
    return `mcp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * MCP Client Manager
 * Manages multiple MCP server connections
 */
export class MCPClientManager {
  private clients: Map<string, MCPServerClient> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = Logger.getInstance();
  }

  /**
   * Create and connect to MCP server
   */
  async addServer(connectionRequest: ServerConnectionRequest): Promise<ServerConnectionResponse> {
    const serverId = connectionRequest.serverId || this.generateServerId();
    const client = new MCPServerClient(connectionRequest.serverUrl, serverId);

    const response = await client.connect(connectionRequest);

    if (response.success) {
      this.clients.set(serverId, client);
      this.logger.info(`[MCP] Server added to manager: ${serverId}`);
    }

    return response;
  }

  /**
   * Get client for server
   */
  getClient(serverId: string): MCPServerClient | null {
    return this.clients.get(serverId) || null;
  }

  /**
   * Remove server connection
   */
  async removeServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (client) {
      await client.disconnect();
      this.clients.delete(serverId);
      this.logger.info(`[MCP] Server removed from manager: ${serverId}`);
    }
  }

  /**
   * Get all connected servers
   */
  getConnectedServers(): MCPServerInfo[] {
    return Array.from(this.clients.values())
      .filter((client) => client.isConnected())
      .map((client) => client.getServerInfo()!)
      .filter((info): info is MCPServerInfo => info !== null);
  }

  /**
   * Disconnect all servers
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.clients.values()).map((client) =>
      client.disconnect().catch((error) => this.logger.error(`[MCP] Disconnect error: ${error}`))
    );

    await Promise.all(disconnectPromises);
    this.clients.clear();
    this.logger.info(`[MCP] All servers disconnected`);
  }

  /**
   * Generate unique server ID
   */
  private generateServerId(): string {
    return `server-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export singleton instance
export const mcpClientManager = new MCPClientManager();
