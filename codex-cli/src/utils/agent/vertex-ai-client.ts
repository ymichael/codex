import { log, isLoggingEnabled } from './log.js';
import { VertexAI } from '@google-cloud/vertexai';
import { Readable } from 'stream';

/**
 * Type definitions for Vertex AI responses and function call arguments
 */
interface VertexAIContentPart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
}

interface VertexAICandidate {
  content: {
    parts: Array<VertexAIContentPart>;
  };
  finishReason?: string;
}

interface VertexAIChunk {
  candidates?: Array<VertexAICandidate>;
}

interface ChatCompletionStreamOutput {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role: string;
      content?: string;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
}

interface ChatMessage {
  role: string;
  content: string | Array<{type: string; text?: string}>;
}

interface FunctionTool {
  type: string;
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * VertexAIClient provides a minimal interface for interacting with Vertex AI,
 * focused on the functionality needed for the Codex CLI.
 */
export class VertexAIClient {
  private vertexAI: VertexAI;
  
  constructor(options: {
    projectId: string;
    location: string;
  }) {
    this.vertexAI = new VertexAI({
      project: options.projectId,
      location: options.location,
    });
  }

  public chat = {
    completions: {
      create: async (options: {
        model: string;
        messages: Array<ChatMessage>;
        stream: boolean;
        tools?: Array<FunctionTool>;
      }): Promise<Readable & { controller: { abort: () => void } } | unknown> => {
        if (isLoggingEnabled()) {
          log(`VertexAIClient: Creating chat completion with model ${options.model}`);
        }

        // Extract system message and regular messages
        const systemMessage = options.messages.find(msg => msg.role === 'system');
        const nonSystemMessages = options.messages.filter(msg => msg.role !== 'system');
        
        // Convert OpenAI format messages to Vertex AI format
        const contents = nonSystemMessages.map(msg => {
          // Handle text content
          const content = typeof msg.content === 'string' 
            ? msg.content 
            : Array.isArray(msg.content) 
              ? msg.content.map((c: {type: string; text?: string}) => typeof c === 'string' ? c : (c.type === 'text' ? c.text : '')).join(' ')
              : '';

          const role = msg.role === 'assistant' ? 'model' : 'user';

          return {
            role,
            parts: [{text: content}]
          };
        });
        
        // Get the generative model from Vertex AI
        const generativeModel = this.vertexAI.getGenerativeModel({
          model: options.model,
          generationConfig: {
            maxOutputTokens: 2048
          },
          // Add system instruction if present
          ...(systemMessage && {
            systemInstruction: {
              role: 'system',
              parts: [{
                text: typeof systemMessage.content === 'string' 
                  ? systemMessage.content 
                  : Array.isArray(systemMessage.content)
                    ? systemMessage.content.map((c: {type: string; text?: string}) => typeof c === 'string' ? c : (c.type === 'text' ? c.text : '')).join(' ')
                    : ''
              }]
            }
          })
        });

        // Handle tools/function calling
        if (options.tools && options.tools.length > 0) {
          const functionDeclarations = options.tools
            .filter((tool: FunctionTool) => tool.type === "function")
            .map((tool: FunctionTool) => ({
              name: tool.function.name,
              description: tool.function.description || '',
              parameters: tool.function.parameters || {},
            }));

          if (functionDeclarations.length > 0) {
            // Handle streaming vs non-streaming with function calling
            if (options.stream) {
              try {
                const streamingResult = await generativeModel.generateContentStream({
                  contents,
                  // Type assertion to overcome type incompatibility with Vertex AI SDK
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  tools: [{ functionDeclarations: functionDeclarations as unknown as any }]
                });
                return this.createStreamAdapter(streamingResult.stream, options.model);
              } catch (error) {
                if (isLoggingEnabled()) {
                  log(`Vertex AI streaming error: ${error instanceof Error ? error.message : String(error)}`);
                }
                throw error;
              }
            } else {
              try {
                return await generativeModel.generateContent({
                  contents,
                  // Type assertion to overcome type incompatibility with Vertex AI SDK
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  tools: [{ functionDeclarations: functionDeclarations as unknown as any }]
                });
              } catch (error) {
                if (isLoggingEnabled()) {
                  log(`Vertex AI error: ${error instanceof Error ? error.message : String(error)}`);
                }
                throw error;
              }
            }
          }
        }
        
        // No function calling - handle streaming vs non-streaming
        if (options.stream) {
          try {
            const streamingResult = await generativeModel.generateContentStream({
              contents
            });
            return this.createStreamAdapter(streamingResult.stream, options.model);
          } catch (error) {
            if (isLoggingEnabled()) {
              log(`Vertex AI streaming error: ${error instanceof Error ? error.message : String(error)}`);
            }
            throw error;
          }
        } else {
          try {
            return await generativeModel.generateContent({
              contents
            });
          } catch (error) {
            if (isLoggingEnabled()) {
              log(`Vertex AI error: ${error instanceof Error ? error.message : String(error)}`);
            }
            throw error;
          }
        }
      }
    }
  };

  /**
   * Create a stream adapter that matches the expected interface from OpenAI
   */
  private createStreamAdapter(
    vertexStream: AsyncIterable<unknown>, 
    model: string
  ): Readable & { controller: { abort: () => void } } {
    const readable = new Readable({
      objectMode: true,
      read() {}
    });

    // Process the stream
    (async () => {
      try {
        let index = 0;
        for await (const chunk of vertexStream) {
          // Transform the chunk
          const transformedChunk = this.transformChunk(chunk as VertexAIChunk, model, index++);
          readable.push(transformedChunk);
        }
        readable.push(null); // End the stream
      } catch (error) {
        readable.emit('error', error);
      }
    })();

    // Add the controller property needed by AgentLoop
    return Object.assign(readable, {
      controller: {
        abort: () => {
          readable.push(null);
        }
      }
    });
  }

  /**
   * Transform a Vertex AI chunk to match the format expected by AgentLoop
   */
  private transformChunk(chunk: VertexAIChunk, model: string, index: number): ChatCompletionStreamOutput {
    // Extract content
    let content = '';
    let functionCall = null;
    
    if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) {
      content = chunk.candidates[0].content.parts[0].text;
    }

    // Check for function calls
    const part = chunk.candidates?.[0]?.content?.parts?.[0];
    if (part?.functionCall) {
      const fc = part.functionCall;
      functionCall = {
        name: fc.name,
        arguments: JSON.stringify(fc.args || {}),
      };
    }

    // Create a structure that matches what AgentLoop expects
    return {
      id: `chatcmpl-${Date.now()}-${index}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        delta: functionCall ? {
          role: 'assistant',
          tool_calls: [{
            id: `call-${Date.now()}-${index}`,
            type: 'function',
            function: functionCall,
          }]
        } : {
          role: 'assistant',
          content: content,
        },
        finish_reason: chunk.candidates?.[0]?.finishReason || null
      }]
    };
  }
} 