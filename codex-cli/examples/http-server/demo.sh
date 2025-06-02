#!/bin/bash

# Demo script for Codex HTTP server
# This script demonstrates how to use the HTTP API

echo "🚀 Starting Codex HTTP Server Demo"
echo ""

# Check if server is running
echo "📋 Checking server health..."
if curl -s http://localhost:3000/health > /dev/null; then
    echo "✅ Server is running!"
else
    echo "❌ Server is not running. Please start it with:"
    echo "   open-codex server --port 3000"
    echo ""
    echo "Or build and run from source:"
    echo "   npm run build && node dist/cli.js server --port 3000"
    exit 1
fi

echo ""

# Test health endpoint
echo "🔍 Health check response:"
curl -s http://localhost:3000/health | jq .
echo ""

# Test simple chat
echo "💬 Testing simple chat (suggest mode):"
curl -s -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Explain what is HTTP in simple terms",
    "approvalMode": "suggest"
  }' | jq '.sessionId, .status, .messages | length'

echo ""

# Test auto-edit mode
echo "🛠️  Testing auto-edit mode:"
curl -s -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Create a simple package.json file for a Node.js project",
    "approvalMode": "auto-edit"
  }' | jq '.sessionId, .status, .messages | length'

echo ""
echo "✅ Demo completed! Check the server logs for detailed output."
echo ""
echo "💡 Try the interactive test client:"
echo "   node examples/http-server/test-client.js \"Write a hello world script\""