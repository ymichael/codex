import { describe, it, expect, vi } from "vitest";

// Fake stream that waits a bit before yielding the function_call so the test
// can cancel first.
class SlowFunctionCallStream {
  public controller = { abort: vi.fn() };

  async *[Symbol.asyncIterator]() {
    await new Promise((r) => setTimeout(r, 30));
    yield {
      choices: [
        {
          delta: {
            role: "assistant",
            tool_calls: [
              {
                id: "slow_call",
                function: {
                  name: "shell",
                  arguments: JSON.stringify({ cmd: ["echo", "hi"] }),
                },
              },
            ],
          },
        },
      ],
    } as any;

    yield {
      choices: [
        {
          delta: {},
          finish_reason: "tool_calls",
        },
      ],
    } as any;
  }
}

vi.mock("openai", () => {
  const bodies: Array<any> = [];
  let callCount = 0;
  class FakeOpenAI {
    public chat = {
      completions: {
        create: async (body: any) => {
          bodies.push(body);
          callCount += 1;
          if (callCount === 1) {
            return new SlowFunctionCallStream();
          }
          return new (class {
            public controller = { abort: vi.fn() };
            async *[Symbol.asyncIterator]() {}
          })();
        },
      },
    };
  }

  class APIConnectionTimeoutError extends Error {}

  return {
    __esModule: true,
    default: FakeOpenAI,
    APIConnectionTimeoutError,
    _test: { getBodies: () => bodies },
  };
});

vi.mock("../src/approvals.js", () => ({
  __esModule: true,
  alwaysApprovedCommands: new Set<string>(),
  canAutoApprove: () => ({ type: "auto-approve", runInSandbox: false } as any),
}));

vi.mock("../src/format-command.js", () => ({
  __esModule: true,
  formatCommandForDisplay: (c: Array<string>) => c.join(" "),
}));

vi.mock("../src/utils/agent/log.js", () => ({
  __esModule: true,
  log: () => {},
  isLoggingEnabled: () => false,
}));

import { AgentLoop } from "../src/utils/agent/agent-loop.js";

describe("cancel before first function_call", () => {
  it("clears previous_response_id if no call ids captured", async () => {
    const { _test } = (await import("openai")) as any;

    const agent = new AgentLoop({
      model: "any",
      instructions: "",
      approvalPolicy: { mode: "auto" } as any,
      onItem: () => {},
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" } as any),
      onReset: () => {},
      config: { model: "any", instructions: "" },
    });

    // Start first run.
    agent.run([
      {
        role: "user",
        content: [{ type: "text", text: "do" }],
      },
    ] as any);

    // Cancel quickly before any stream item.
    await new Promise((r) => setTimeout(r, 5));
    agent.cancel();

    // Second run.
    await agent.run([
      {
        role: "user",
        content: [{ type: "text", text: "new" }],
      },
    ] as any);

    const bodies = _test.getBodies();
    const last = bodies[bodies.length - 1];
    expect(last.previous_response_id).toBeUndefined();
  });
});
