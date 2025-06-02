import type { ApprovalPolicy } from "./approvals.js";
import type { CommandConfirmation } from "./utils/agent/agent-loop.js";
import type { AppConfig } from "./utils/config.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.mjs";

import { AgentLoop } from "./utils/agent/agent-loop.js";
import { ReviewDecision } from "./utils/agent/review.js";
import { AutoApprovalMode } from "./utils/auto-approval-mode.js";
import { createInputItem } from "./utils/input-utils.js";
import { randomUUID } from "node:crypto";

type ServerConfig = {
  port: number;
  host: string;
  config: AppConfig;
};

type ChatRequest = {
  prompt: string;
  imagePaths?: Array<string>;
  approvalMode?: "suggest" | "auto-edit" | "full-auto"; // Note: HTTP mode forces read-only
  sessionId?: string;
};

type ChatResponse = {
  sessionId: string;
  messages: Array<ChatCompletionMessageParam>;
  status: "completed" | "error";
  error?: string;
};

// Store active sessions
const activeSessions = new Map<string, AgentLoop>();

// Define read-only tool functions (tools that only read, don't modify)
const READ_ONLY_TOOLS = new Set([
  "Read",
  "Glob", 
  "Grep",
  "LS",
  "NotebookRead",
  "WebFetch",
  "WebSearch",
  "TodoRead"
]);

// Tools that modify files or execute commands (blocked in HTTP mode)
const WRITE_TOOLS = new Set([
  "Edit",
  "MultiEdit", 
  "Write",
  "NotebookEdit",
  "Bash",
  "TodoWrite",
  "Task"
]);

function isReadOnlyToolCall(toolCall: any): boolean {
  const functionName = toolCall?.function?.name;
  return READ_ONLY_TOOLS.has(functionName);
}

function isWriteToolCall(toolCall: any): boolean {
  const functionName = toolCall?.function?.name;
  return WRITE_TOOLS.has(functionName);
}

function filterMessageForReadOnly(item: ChatCompletionMessageParam): ChatCompletionMessageParam | null {
  // If it's an assistant message with tool calls, filter out write operations
  if (item.role === "assistant" && "tool_calls" in item && item.tool_calls) {
    const writeToolCalls = item.tool_calls.filter(isWriteToolCall);
    const readToolCalls = item.tool_calls.filter(isReadOnlyToolCall);
    
    // If there are write tool calls, replace with a friendly message
    if (writeToolCalls.length > 0) {
      const writeOperations = writeToolCalls.map(tc => tc.function.name).join(", ");
      const friendlyMessage = `I can see you'd like me to perform write operations (${writeOperations}), but I'm running in read-only mode via HTTP. I can help you understand your codebase, analyze files, search for patterns, and answer questions, but I cannot modify files or execute commands.\n\nWould you like me to help you explore or analyze your code instead?`;
      
      // If there are also read operations, keep those and add the message
      if (readToolCalls.length > 0) {
        return {
          ...item,
          tool_calls: readToolCalls,
          content: (typeof item.content === "string" ? item.content + "\n\n" : "") + friendlyMessage
        };
      } else {
        // Only write operations - replace with friendly message
        return {
          ...item,
          tool_calls: undefined,
          content: friendlyMessage
        };
      }
    }
  }
  
  // For tool responses from write operations, don't include them
  if (item.role === "tool" && "tool_call_id" in item) {
    // We can't easily determine if this was from a write tool without more context
    // So we'll let tool responses through, but they shouldn't happen since we filter the calls
    return item;
  }
  
  // Pass through all other messages unchanged
  return item;
}

export async function runServer({ port, host, config }: ServerConfig): Promise<void> {
  // Use Node.js built-in HTTP server to avoid external dependencies
  const { createServer } = await import("node:http");
  const { parse } = await import("node:url");
  
  const server = createServer(async (req, res) => {
    // Enable CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    
    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = parse(req.url || "", true);
    
    try {
      if (req.method === "POST" && url.pathname === "/chat") {
        await handleChatRequest(req, res, config);
      } else if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", version: "0.1.31" }));
      } else if (req.method === "DELETE" && url.pathname?.startsWith("/sessions/")) {
        const sessionId = url.pathname.split("/")[2];
        if (sessionId) {
          await handleSessionTerminate(res, sessionId);
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session ID required" }));
        }
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Server error:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });

  // Return a promise that resolves when server starts
  return new Promise<void>((resolve, reject) => {
    server.on('error', (error) => {
      console.error("❌ Server error:", error);
      reject(error);
    });
    
    server.listen(port, host, () => {
      // eslint-disable-next-line no-console
      console.log(`🚀 Codex HTTP server running at http://${host}:${port} (READ-ONLY MODE)`);
      // eslint-disable-next-line no-console
      console.log(`📋 Health check: http://${host}:${port}/health`);
      // eslint-disable-next-line no-console
      console.log(`💬 Chat endpoint: POST http://${host}:${port}/chat`);
      // eslint-disable-next-line no-console
      console.log(`🔒 Note: HTTP mode only allows read operations (file analysis, code exploration)`);
      resolve();
    });
  });
}

async function handleChatRequest(
  req: NodeJS.ReadableStream,
  res: NodeJS.WritableStream & { writeHead: (code: number, headers?: Record<string, string>) => void; end: (data?: string) => void },
  config: AppConfig
): Promise<void> {
  let body = "";
  
  for await (const chunk of req) {
    body += chunk.toString();
  }

  const chatRequest: ChatRequest = JSON.parse(body);
  const sessionId = chatRequest.sessionId || randomUUID();
  
  // HTTP mode is always read-only - force SUGGEST mode regardless of request
  const approvalPolicy: ApprovalPolicy = AutoApprovalMode.SUGGEST;

  const messages: Array<ChatCompletionMessageParam> = [];
  let hasError = false;
  let errorMessage = "";

  try {
    // Create or reuse agent for this session
    let agent = activeSessions.get(sessionId);
    
    if (!agent) {
      // Add read-only instructions to the existing instructions
      const readOnlyInstructions = `${config.instructions || ""}

IMPORTANT: You are running in READ-ONLY HTTP mode. You can only:
- Read files (Read, Glob, Grep, LS, NotebookRead)
- Search and analyze code
- Answer questions about the codebase
- Provide explanations and documentation

You CANNOT:
- Edit or write files (Edit, MultiEdit, Write, NotebookEdit)
- Execute commands (Bash)
- Create todos (TodoWrite)
- Perform any modification operations

If the user asks you to modify files or run commands, politely explain that you're in read-only mode and offer to help with code analysis instead.`;

      agent = new AgentLoop({
        model: config.model,
        config: config,
        instructions: readOnlyInstructions,
        approvalPolicy,
        onItem: (item: ChatCompletionMessageParam) => {
          // Filter and modify messages for read-only mode
          const filteredItem = filterMessageForReadOnly(item);
          if (filteredItem) {
            messages.push(filteredItem);
          }
        },
        onLoading: () => {
          // HTTP doesn't need loading indicators
        },
        getCommandConfirmation: (
          _command: Array<string>,
        ): Promise<CommandConfirmation> => {
          // In HTTP read-only mode, always deny command execution
          return Promise.resolve({ review: ReviewDecision.NO_CONTINUE });
        },
        onReset: () => {
          // Reset handled internally
        },
      });
      
      activeSessions.set(sessionId, agent);
    }

    const inputItem = await createInputItem(
      chatRequest.prompt,
      chatRequest.imagePaths || []
    );
    
    await agent.run([inputItem]);

  } catch (error) {
    hasError = true;
    errorMessage = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("Agent error:", error);
  }

  const response: ChatResponse = {
    sessionId,
    messages,
    status: hasError ? "error" : "completed",
    ...(hasError && { error: errorMessage }),
  };

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(response, null, 2));
}

async function handleSessionTerminate(
  res: NodeJS.WritableStream & { writeHead: (code: number, headers?: Record<string, string>) => void; end: (data?: string) => void }, 
  sessionId: string
): Promise<void> {
  const agent = activeSessions.get(sessionId);
  
  if (agent) {
    agent.terminate();
    activeSessions.delete(sessionId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Session terminated" }));
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Session not found" }));
  }
}