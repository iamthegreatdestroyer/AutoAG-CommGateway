import { PrismaClient, Transaction, TransactionStatus } from '@prisma/client';
import { BaseRepository } from './base.repository';

export class TransactionRepository extends BaseRepository<Transaction> {
  constructor(prisma: PrismaClient) {
    super(prisma, 'transaction');
  }

  async findByUser(
    userId: string,
    params?: { page?: number; limit?: number }
  ): Promise<Transaction[]> {
    const { page = 1, limit = 20 } = params || {};

    return this.prisma.transaction.findMany({
      where: { userId },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        server: {
          select: {
            id: true,
            name: true,
            displayName: true,
          },
        },
      },
    });
  }

  async findByServer(
    serverId: string,
    params?: { page?: number; limit?: number }
  ): Promise<Transaction[]> {
    const { page = 1, limit = 20 } = params || {};

    return this.prisma.transaction.findMany({
      where: { serverId },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });
  }

  async updateStatus(
    transactionId: string,
    status: TransactionStatus,
    metadata?: any
  ): Promise<Transaction> {
    return this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status,
        completedAt: status === 'COMPLETED' ? new Date() : undefined,
        ...metadata,
      },
    });
  }

  async getUserBalance(userId: string): Promise<number> {
    const result = await this.prisma.transaction.aggregate({
      where: {
        userId,
        status: 'COMPLETED',
      },
      _sum: {
        netAmount: true,
      },
    });

    return Number(result._sum.netAmount || 0);
  }

  async getServerRevenue(serverId: string, startDate?: Date, endDate?: Date): Promise<number> {
    const where: any = {
      serverId,
      status: 'COMPLETED',
      type: 'PAYMENT',
    };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const result = await this.prisma.transaction.aggregate({
      where,
      _sum: {
        netAmount: true,
      },
    });

    return Number(result._sum.netAmount || 0);
  }

  async getPendingPayouts(serverId?: string): Promise<Transaction[]> {
    return this.prisma.transaction.findMany({
      where: {
        type: 'PAYOUT',
        status: 'PENDING',
        serverId,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createPayment(data: {
    userId: string;
    serverId: string;
    amount: number;
    platformFee: number;
    description?: string;
  }): Promise<Transaction> {
    return this.prisma.transaction.create({
      data: {
        userId: data.userId,
        serverId: data.serverId,
        type: 'PAYMENT',
        amount: data.amount,
        platformFee: data.platformFee,
        netAmount: data.amount - data.platformFee,
        status: 'PENDING',
        currency: 'USD',
        description: data.description,
      },
    });
  }
}
