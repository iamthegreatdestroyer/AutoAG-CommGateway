/**
 * Main Application Entry Point
 * Integrates all services and configures Express server
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { v4 as uuidv4 } from 'uuid';

import { Logger } from './utils/logger';
import { ErrorHandler } from './middleware/error.middleware';
import MCPController from './controllers/mcp.controller';
import { MCPClientManager } from './services/mcp-client.service';
import { mcpServerRegistryService } from './services/mcp-registry.service';

/**
 * Application class
 */
export class Application {
  private app: Express;
  private logger: Logger;
  private clientManager: MCPClientManager;
  private port: number;

  constructor(port: number = 3000) {
    this.app = express();
    this.logger = Logger.getInstance();
    this.clientManager = new MCPClientManager();
    this.port = port;

    this.setupMiddleware();
    this.setupControllers();
    this.setupErrorHandling();
  }

  /**
   * Setup middleware
   */
  private setupMiddleware(): void {
    // CORS
    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true,
    }));

    // Security headers
    this.app.use(helmet());

    // Request logging
    this.app.use(morgan('combined', {
      stream: {
        write: (message) => this.logger.info(message.trim()),
      },
    }));

    // JSON parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ limit: '10mb', extended: true }));

    // Request tracing
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const correlationId = req.headers['x-correlation-id'] || uuidv4();
      (req as any).correlationId = correlationId;
      res.set('X-Correlation-ID', String(correlationId));
      next();
    });

    // Request validation middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      this.logger.debug(`[${req.method}] ${req.path}`, {
        correlationId: (req as any).correlationId,
      });
      next();
    });
  }

  /**
   * Setup controllers and routes
   */
  private setupControllers(): void {
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
      });
    });

    // API info
    this.app.get('/api/info', (req: Request, res: Response) => {
      res.status(200).json({
        name: 'AutoAG-CommGateway',
        version: '1.0.0',
        description: 'MCP Client & Orchestration Gateway',
        endpoints: {
          mcp: '/api/mcp',
          health: '/health',
        },
      });
    });

    // MCP routes
    const mcpController = new MCPController(this.clientManager);
    this.app.use('/api/mcp', mcpController.getRouter());

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        success: false,
        error: `Route not found: ${req.path}`,
        method: req.method,
      });
    });
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling(): void {
    const errorHandler = new ErrorHandler();
    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      errorHandler.handle(err, req, res);
    });
  }

  /**
   * Start the application
   */
  async start(): Promise<void> {
    try {
      // Initialize registry with default servers
      mcpServerRegistryService.loadDefaultRegistry();

      // Start server
      this.app.listen(this.port, () => {
        this.logger.info(`[Application] Server started on port ${this.port}`, {
          environment: process.env.NODE_ENV || 'development',
          url: `http://localhost:${this.port}`,
        });
      });

      // Graceful shutdown
      process.on('SIGTERM', () => this.shutdown());
      process.on('SIGINT', () => this.shutdown());
    } catch (error) {
      this.logger.error(`[Application] Failed to start: ${error}`);
      process.exit(1);
    }
  }

  /**
   * Shutdown the application gracefully
   */
  private async shutdown(): Promise<void> {
    this.logger.info('[Application] Shutting down gracefully...');

    try {
      // Disconnect all MCP servers
      await this.clientManager.disconnectAll();

      this.logger.info('[Application] Shutdown complete');
      process.exit(0);
    } catch (error) {
      this.logger.error(`[Application] Shutdown error: ${error}`);
      process.exit(1);
    }
  }

  /**
   * Get Express app
   */
  getApp(): Express {
    return this.app;
  }

  /**
   * Get MCP client manager
   */
  getClientManager(): MCPClientManager {
    return this.clientManager;
  }
}

// Start application if run directly
if (require.main === module) {
  const port = parseInt(process.env.PORT || '3000', 10);
  const app = new Application(port);
  app.start();
}

export default Application;
