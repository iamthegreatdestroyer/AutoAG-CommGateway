import request from 'supertest';
import app from '../../src/index';

// Mock Prisma and Redis before importing routes
jest.mock('@prisma/client', () => {
  const mockPrismaClient = {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  };
  return {
    PrismaClient: jest.fn(() => mockPrismaClient),
  };
});

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue(undefined),
  }));
});

describe('Health Endpoint', () => {
  it('should return health status', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('uptime');
    expect(response.body).toHaveProperty('services');
  });

  it('should include service health checks', async () => {
    const response = await request(app).get('/health');

    expect(response.body.services).toHaveProperty('api');
    expect(response.body.services).toHaveProperty('database');
    expect(response.body.services).toHaveProperty('redis');
    expect(response.body.services.api).toBe('healthy');
  });
});
