#!/bin/bash

# AutoAG-CommGateway Development Setup Script

echo "🚀 Setting up AutoAG-CommGateway development environment..."

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 20+ first."
    exit 1
fi

echo "✅ Node.js version: $(node --version)"

# Check for npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed."
    exit 1
fi

echo "✅ npm version: $(npm --version)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Copy environment file
if [ ! -f .env ]; then
    echo "📝 Creating .env file from .env.example..."
    cp .env.example .env
    echo "⚠️  Please update .env with your configuration"
else
    echo "✅ .env file already exists"
fi

# Generate Prisma Client
echo "🔨 Generating Prisma Client..."
npx prisma generate

# Check for Docker
if command -v docker &> /dev/null; then
    echo "✅ Docker is available"
    echo "🐳 Starting Docker services..."
    cd docker && docker-compose up -d
    cd ..
    
    # Wait for database to be ready
    echo "⏳ Waiting for database to be ready..."
    sleep 5
    
    # Run migrations
    echo "🗄️  Running database migrations..."
    npx prisma migrate dev --name init
    
    echo "✅ Database setup complete!"
else
    echo "⚠️  Docker not found. Please install Docker and run 'cd docker && docker-compose up -d' manually"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Update .env with your configuration"
echo "  2. Run 'npm run dev' to start the development server"
echo "  3. Visit http://localhost:18500/health to verify"
echo ""
