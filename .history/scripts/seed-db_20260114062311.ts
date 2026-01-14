import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱 Seeding database...');

  // Create admin user
  const adminPasswordHash = await bcrypt.hash('Admin123!', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@autoag.dev' },
    update: {},
    create: {
      email: 'admin@autoag.dev',
      passwordHash: adminPasswordHash,
      username: 'admin',
      firstName: 'System',
      lastName: 'Administrator',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
      apiKey: 'sk_admin_test_key_123456789',
    },
  });
  console.log('✅ Created admin user:', admin.email);

  // Create developer user
  const devPasswordHash = await bcrypt.hash('Developer123!', 10);
  const developer = await prisma.user.upsert({
    where: { email: 'developer@autoag.dev' },
    update: {},
    create: {
      email: 'developer@autoag.dev',
      passwordHash: devPasswordHash,
      username: 'developer1',
      firstName: 'John',
      lastName: 'Developer',
      role: 'DEVELOPER',
      status: 'ACTIVE',
      emailVerified: true,
      walletBalance: 100.0,
    },
  });
  console.log('✅ Created developer user:', developer.email);

  // Create regular user
  const userPasswordHash = await bcrypt.hash('User123!', 10);
  const user = await prisma.user.upsert({
    where: { email: 'user@autoag.dev' },
    update: {},
    create: {
      email: 'user@autoag.dev',
      passwordHash: userPasswordHash,
      username: 'testuser',
      firstName: 'Jane',
      lastName: 'User',
      role: 'USER',
      status: 'ACTIVE',
      emailVerified: true,
      walletBalance: 50.0,
    },
  });
  console.log('✅ Created regular user:', user.email);

  // Create sample MCP servers
  const weatherServer = await prisma.mCPServer.upsert({
    where: { ownerId_name: { ownerId: developer.id, name: 'weather-api' } },
    update: {},
    create: {
      ownerId: developer.id,
      name: 'weather-api',
      displayName: 'Weather API Server',
      description: 'Comprehensive weather data and forecasting service',
      baseUrl: 'https://weather.example.com',
      version: '1.0.0',
      status: 'ACTIVE',
      visibility: 'PUBLIC',
      pricingModel: 'PAY_PER_CALL',
      pricePerCall: 0.01,
      category: ['weather', 'data', 'api'],
      tags: ['weather', 'forecast', 'climate'],
      healthStatus: 'HEALTHY',
      totalCalls: 1250,
      totalRevenue: 12.5,
      rating: 4.5,
      reviewCount: 25,
      publishedAt: new Date(),
    },
  });
  console.log('✅ Created MCP server:', weatherServer.displayName);

  const nlpServer = await prisma.mCPServer.upsert({
    where: { ownerId_name: { ownerId: developer.id, name: 'nlp-toolkit' } },
    update: {},
    create: {
      ownerId: developer.id,
      name: 'nlp-toolkit',
      displayName: 'NLP Toolkit',
      description: 'Natural Language Processing tools for text analysis',
      baseUrl: 'https://nlp.example.com',
      version: '2.1.0',
      status: 'ACTIVE',
      visibility: 'PUBLIC',
      pricingModel: 'SUBSCRIPTION',
      subscriptionPrice: 29.99,
      category: ['nlp', 'ai', 'text-analysis'],
      tags: ['nlp', 'sentiment', 'entities', 'translation'],
      healthStatus: 'HEALTHY',
      totalCalls: 5420,
      totalRevenue: 299.90,
      rating: 4.8,
      reviewCount: 48,
      publishedAt: new Date(),
    },
  });
  console.log('✅ Created MCP server:', nlpServer.displayName);

  // Create tools for weather server
  const weatherTool = await prisma.tool.upsert({
    where: { serverId_name: { serverId: weatherServer.id, name: 'get-current-weather' } },
    update: {},
    create: {
      serverId: weatherServer.id,
      name: 'get-current-weather',
      displayName: 'Get Current Weather',
      description: 'Get current weather conditions for a location',
      inputSchema: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name or coordinates' },
          units: { type: 'string', enum: ['metric', 'imperial'], default: 'metric' },
        },
        required: ['location'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          temperature: { type: 'number' },
          humidity: { type: 'number' },
          conditions: { type: 'string' },
        },
      },
      pricePerCall: 0.01,
      totalCalls: 850,
      totalRevenue: 8.5,
      avgResponseTime: 250,
      successRate: 98.5,
    },
  });
  console.log('✅ Created tool:', weatherTool.displayName);

  const forecastTool = await prisma.tool.upsert({
    where: { serverId_name: { serverId: weatherServer.id, name: 'get-forecast' } },
    update: {},
    create: {
      serverId: weatherServer.id,
      name: 'get-forecast',
      displayName: 'Get Weather Forecast',
      description: 'Get 7-day weather forecast',
      inputSchema: {
        type: 'object',
        properties: {
          location: { type: 'string' },
          days: { type: 'number', minimum: 1, maximum: 7, default: 7 },
        },
        required: ['location'],
      },
      pricePerCall: 0.02,
      totalCalls: 400,
      totalRevenue: 8.0,
      avgResponseTime: 380,
      successRate: 97.2,
    },
  });
  console.log('✅ Created tool:', forecastTool.displayName);

  // Create tools for NLP server
  const sentimentTool = await prisma.tool.upsert({
    where: { serverId_name: { serverId: nlpServer.id, name: 'analyze-sentiment' } },
    update: {},
    create: {
      serverId: nlpServer.id,
      name: 'analyze-sentiment',
      displayName: 'Analyze Sentiment',
      description: 'Analyze sentiment of text (positive, negative, neutral)',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to analyze' },
          language: { type: 'string', default: 'en' },
        },
        required: ['text'],
      },
      totalCalls: 2340,
      avgResponseTime: 180,
      successRate: 99.1,
    },
  });
  console.log('✅ Created tool:', sentimentTool.displayName);

  // Create sample transactions
  const transaction1 = await prisma.transaction.create({
    data: {
      userId: user.id,
      serverId: weatherServer.id,
      type: 'PAYMENT',
      amount: 0.01,
      platformFee: 0.0015,
      netAmount: 0.0085,
      status: 'COMPLETED',
      currency: 'USD',
      description: 'Payment for get-current-weather tool invocation',
      completedAt: new Date(),
    },
  });
  console.log('✅ Created transaction:', transaction1.id);

  // Create sample reviews
  const review1 = await prisma.review.upsert({
    where: { serverId_userId: { serverId: weatherServer.id, userId: user.id } },
    update: {},
    create: {
      serverId: weatherServer.id,
      userId: user.id,
      rating: 5,
      title: 'Excellent weather API!',
      comment: 'Very accurate and fast. Great documentation too.',
      isVerified: true,
    },
  });
  console.log('✅ Created review:', review1.id);

  // Create analytics entry
  const analytics = await prisma.analytics.upsert({
    where: {
      serverId_date: {
        serverId: weatherServer.id,
        date: new Date(new Date().setHours(0, 0, 0, 0)),
      },
    },
    update: {},
    create: {
      serverId: weatherServer.id,
      date: new Date(new Date().setHours(0, 0, 0, 0)),
      totalCalls: 125,
      successfulCalls: 122,
      failedCalls: 3,
      uniqueUsers: 15,
      totalRevenue: 1.25,
      avgResponseTime: 265,
    },
  });
  console.log('✅ Created analytics entry:', analytics.id);

  console.log('');
  console.log('✅ Seeding complete!');
  console.log('');
  console.log('📝 Test Accounts:');
  console.log('  Admin:     admin@autoag.dev / Admin123!');
  console.log('  Developer: developer@autoag.dev / Developer123!');
  console.log('  User:      user@autoag.dev / User123!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
