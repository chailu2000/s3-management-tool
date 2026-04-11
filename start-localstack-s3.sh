#!/bin/bash
# Start LocalStack with S3 enabled for E2E testing

echo "🚀 Starting LocalStack with S3 service..."

# Stop any existing LocalStack
docker compose -f tests/e2e/config/docker-compose.localstack.yml down 2>/dev/null || true

# Start LocalStack with S3
docker compose -f tests/e2e/config/docker-compose.localstack.yml up -d

echo "⏳ Waiting for LocalStack to be ready..."

# Wait for health check
for i in $(seq 1 30); do
  if curl -s http://localhost:4566/_localstack/health | grep -q '"s3": "available"'; then
    echo "✅ LocalStack is ready!"
    echo ""
    echo "📝 Run E2E tests with:"
    echo "   pnpm run test:e2e"
    echo ""
    echo "🛑 To stop LocalStack after testing:"
    echo "   docker compose -f tests/e2e/config/docker-compose.localstack.yml down"
    exit 0
  fi
  echo "   Attempt $i: LocalStack not ready yet, waiting..."
  sleep 2
done

echo "❌ LocalStack failed to start"
docker compose -f tests/e2e/config/docker-compose.localstack.yml logs
exit 1
