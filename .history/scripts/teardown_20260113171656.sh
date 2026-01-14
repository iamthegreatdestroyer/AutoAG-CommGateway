#!/bin/bash

# Teardown development environment

echo "🧹 Tearing down AutoAG-CommGateway development environment..."

# Stop Docker containers
if command -v docker &> /dev/null; then
    echo "🐳 Stopping Docker containers..."
    cd docker && docker-compose down -v
    cd ..
    echo "✅ Docker containers stopped and volumes removed"
fi

# Clean build artifacts
echo "🗑️  Cleaning build artifacts..."
rm -rf dist/
rm -rf node_modules/
rm -rf coverage/
rm -rf logs/
rm -rf .prisma/

echo "✅ Teardown complete!"
