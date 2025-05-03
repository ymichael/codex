import { describe, it, expect, vi } from "vitest";
import { VertexAIClient } from "../src/utils/agent/vertex-ai-client";

// Mock the @google-cloud/vertexai module
vi.mock("@google-cloud/vertexai", () => {
  const mockGenerateContentStream = vi.fn().mockResolvedValue({
    stream: {
      [Symbol.asyncIterator]: async function* () {
        yield {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "Hello, this is a test response",
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        };
      },
    },
  });

  const mockGenerateContent = vi.fn().mockResolvedValue({
    response: {
      candidates: [
        {
          content: {
            parts: [
              {
                text: "Hello, this is a test response",
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    },
  });

  const mockGetGenerativeModel = vi.fn().mockReturnValue({
    generateContentStream: mockGenerateContentStream,
    generateContent: mockGenerateContent,
  });

  return {
    VertexAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: mockGetGenerativeModel,
    })),
    mockGenerateContentStream,
    mockGenerateContent,
    mockGetGenerativeModel,
  };
});

describe("VertexAIClient", () => {
  it("should initialize with project and location", () => {
    const client = new VertexAIClient({
      projectId: "test-project",
      location: "test-location",
    });
    expect(client).toBeDefined();
  });

  it("should create chat completion with streaming enabled", async () => {
    const client = new VertexAIClient({
      projectId: "test-project",
      location: "test-location",
    });

    const stream = await client.chat.completions.create({
      model: "gemini-1.5-pro",
      messages: [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "Hello" },
      ],
      stream: true,
    });

    // Use type assertions to handle the unknown type
    expect(stream).toBeDefined();
    expect((stream as any).controller).toBeDefined();
    expect((stream as any).controller.abort).toBeDefined();

    // Test stream output
    const reader = (stream as any)[Symbol.asyncIterator]();
    const { value } = await reader.next();
    
    expect(value).toBeDefined();
    expect(value.choices[0].delta.content).toBe("Hello, this is a test response");
  });

  it("should handle function calling", async () => {
    const client = new VertexAIClient({
      projectId: "test-project",
      location: "test-location",
    });

    const stream = await client.chat.completions.create({
      model: "gemini-1.5-pro",
      messages: [{ role: "user", content: "What's the weather in London?" }],
      stream: true,
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get the weather for a location",
            parameters: {
              type: "object",
              properties: {
                location: {
                  type: "string",
                  description: "The location to get weather for",
                },
              },
              required: ["location"],
            },
          },
        },
      ],
    });

    expect(stream).toBeDefined();
  });
}); 