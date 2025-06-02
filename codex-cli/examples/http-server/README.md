# HTTP Server Mode (Read-Only)

The Codex CLI can now run as an HTTP server, providing a REST API interface for code analysis and exploration. **HTTP mode is read-only** - it can analyze your codebase, search files, and answer questions, but cannot modify files or execute commands.

## Quick Start

Start the HTTP server:

```bash
open-codex server --port 8080 --host 0.0.0.0
```

## API Endpoints

### POST /chat

Send a chat message to the AI agent.

**Request Body:**
```json
{
  "prompt": "Explain what this Python file does",
  "sessionId": "optional-session-id",
  "imagePaths": ["path/to/image.png"]
}
```

Note: `approvalMode` is ignored - HTTP mode is always read-only.

**Response:**
```json
{
  "sessionId": "uuid-string",
  "messages": [
    {
      "role": "user", 
      "content": "Write a simple Python hello world script"
    },
    {
      "role": "assistant",
      "content": "I'll create a simple Python hello world script for you.",
      "tool_calls": [...]
    }
  ],
  "status": "completed"
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "version": "0.1.31"
}
```

### DELETE /sessions/{sessionId}

Terminate a specific session.

**Response:**
```json
{
  "message": "Session terminated"
}
```

## Read-Only Capabilities

HTTP mode supports these operations:
- **File Reading**: Read any file in the codebase
- **Code Search**: Search for patterns, functions, or text
- **Code Analysis**: Explain code functionality, identify patterns
- **Documentation**: Generate explanations and documentation
- **Code Exploration**: Navigate and understand project structure

HTTP mode **blocks** these operations:
- File editing or creation
- Command execution
- Any modification operations

## Example Usage

```bash
# Start server
open-codex server --port 3000

# Send a chat request
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Analyze the main server file and explain how it works"
  }'

# Check health
curl http://localhost:3000/health
```

## Session Management

The HTTP server maintains sessions to preserve conversation context. If you don't provide a `sessionId`, a new session will be created. Reuse the same `sessionId` to continue a conversation.

Sessions can be terminated using the DELETE endpoint to free up resources.