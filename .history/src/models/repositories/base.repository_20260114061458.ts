import { PrismaClient } from '@prisma/client';

export class BaseRepository<T> {
  protected prisma: PrismaClient;
  protected modelName: string;

  constructor(prisma: PrismaClient, modelName: string) {
    this.prisma = prisma;
    this.modelName = modelName;
  }

  async findById(id: string): Promise<T | null> {
    return (this.prisma[this.modelName as keyof PrismaClient] as any).findUnique({
      where: { id },
    });
  }

  async findMany(options?: any): Promise<T[]> {
    return (this.prisma[this.modelName as keyof PrismaClient] as any).findMany(options);
  }

  async create(data: any): Promise<T> {
    return (this.prisma[this.modelName as keyof PrismaClient] as any).create({
      data,
    });
  }

  async update(id: string, data: any): Promise<T> {
    return (this.prisma[this.modelName as keyof PrismaClient] as any).update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<T> {
    return (this.prisma[this.modelName as keyof PrismaClient] as any).delete({
      where: { id },
    });
  }

  async count(where?: any): Promise<number> {
    return (this.prisma[this.modelName as keyof PrismaClient] as any).count({
      where,
    });
  }

  async exists(where: any): Promise<boolean> {
    const count = await (this.prisma[this.modelName as keyof PrismaClient] as any).count({
      where,
    });
    return count > 0;
  }
}
