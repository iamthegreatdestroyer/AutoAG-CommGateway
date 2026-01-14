// Export all repositories
export * from './base.repository';
export * from './user.repository';
export * from './mcpServer.repository';
export * from './tool.repository';
export * from './transaction.repository';

// Database service for dependency injection
import { PrismaClient } from '@prisma/client';
import { UserRepository } from './user.repository';
import { MCPServerRepository } from './mcpServer.repository';
import { ToolRepository } from './tool.repository';
import { TransactionRepository } from './transaction.repository';

export class DatabaseService {
  public prisma: PrismaClient;
  public users: UserRepository;
  public mcpServers: MCPServerRepository;
  public tools: ToolRepository;
  public transactions: TransactionRepository;

  constructor() {
    this.prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });

    // Initialize repositories
    this.users = new UserRepository(this.prisma);
    this.mcpServers = new MCPServerRepository(this.prisma);
    this.tools = new ToolRepository(this.prisma);
    this.transactions = new TransactionRepository(this.prisma);
  }

  async connect(): Promise<void> {
    await this.prisma.$connect();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      return false;
    }
  }
}

// Singleton instance
export const db = new DatabaseService();
