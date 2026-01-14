import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱 Seeding database...');

  // Create sample MCP server (placeholder for Phase 2)
  const server = await prisma.mCPServer.create({
    data: {
      name: 'Example MCP Server',
      baseUrl: 'http://localhost:3001',
      status: 'active',
    },
  });

  console.log('✅ Created sample MCP server:', server.name);
  console.log('✅ Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
