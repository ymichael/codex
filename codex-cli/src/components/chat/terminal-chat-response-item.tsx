import type { TerminalRendererOptions } from "marked-terminal";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions.mjs";
import type { ResponseReasoningItem } from "openai/resources/responses/responses";

import { useTerminalSize } from "../../hooks/use-terminal-size";
import {
  parseToolCallChatCompletion,
  parseToolCallOutput,
} from "../../utils/parsers";
import chalk, { type ForegroundColorName } from "chalk";
import { Box, Text } from "ink";
import { parse, setOptions } from "marked";
import TerminalRenderer from "marked-terminal";
import React, { useMemo } from "react";

export default function TerminalChatResponseItem({
  item,
  fullStdout = false,
}: {
  item: ChatCompletionMessageParam;
  fullStdout?: boolean;
}): React.ReactElement {
  switch (item.role) {
    case "user":
      return <TerminalChatResponseMessage message={item} />;
    case "assistant":
      return (
        <>
          <TerminalChatResponseMessage message={item} />
          {item.tool_calls?.map((toolCall, i) => {
            return <TerminalChatResponseToolCall key={i} message={toolCall} />;
          })}
        </>
      );
    case "tool":
      return (
        <TerminalChatResponseMessage message={item} fullStdout={fullStdout} />
      );
    default:
      break;
  }
  // Fallback for any other message type
  return <TerminalChatResponseGenericMessage message={item} />;
}

// TODO: this should be part of `ResponseReasoningItem`. Also it doesn't work.
// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Guess how long the assistant spent "thinking" based on the combined length
 * of the reasoning summary. The calculation itself is fast, but wrapping it in
 * `useMemo` in the consuming component ensures it only runs when the
 * `summary` array actually changes.
 */
// TODO: use actual thinking time
//
// function guessThinkingTime(summary: Array<ResponseReasoningItem.Summary>) {
//   const totalTextLength = summary
//     .map((t) => t.text.length)
//     .reduce((a, b) => a + b, summary.length - 1);
//   return Math.max(1, Math.ceil(totalTextLength / 300));
// }

export function TerminalChatResponseReasoning({
  message,
}: {
  message: ResponseReasoningItem & { duration_ms?: number };
}): React.ReactElement | null {
  // prefer the real duration if present
  const thinkingTime = message.duration_ms
    ? Math.round(message.duration_ms / 1000)
    : Math.max(
        1,
        Math.ceil(
          (message.summary || [])
            .map((t) => t.text.length)
            .reduce((a, b) => a + b, 0) / 300,
        ),
      );
  if (thinkingTime <= 0) {
    return null;
  }

  return (
    <Box gap={1} flexDirection="column">
      <Box gap={1}>
        <Text bold color="magenta">
          thinking
        </Text>
        <Text dimColor>for {thinkingTime}s</Text>
      </Box>
      {message.summary?.map((summary, key) => {
        const s = summary as { headline?: string; text: string };
        return (
          <Box key={key} flexDirection="column">
            {s.headline && <Text bold>{s.headline}</Text>}
            <Markdown>{s.text}</Markdown>
          </Box>
        );
      })}
    </Box>
  );
}

const colorsByRole: Record<string, ForegroundColorName> = {
  assistant: "magentaBright",
  user: "blueBright",
};

function TerminalChatResponseMessage({
  message,
  fullStdout,
}: {
  message: ChatCompletionMessageParam;
  fullStdout?: boolean;
}) {
  const contentParts: Array<string> = [];
  if (typeof message.content === "string") {
    contentParts.push(message.content);
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "text") {
        contentParts.push(part.text);
      }
      if (part.type === "refusal") {
        contentParts.push(part.refusal);
      }
      if (part.type === "image_url") {
        contentParts.push(`<Image />`);
      }
      if (part.type === "file") {
        contentParts.push(`<File />`);
      }
    }
  }
  const content = contentParts.join("");
  if (content.length === 0) {
    return null;
  }
  if (message.role === "tool" && !("tool_calls" in message)) {
    return (
      <TerminalChatResponseToolCallOutput
        content={content}
        fullStdout={!!fullStdout}
      />
    );
  }
  return (
    <Box flexDirection="column">
      <Text bold color={colorsByRole[message.role] || "gray"}>
        {message.role === "assistant" ? "codex" : message.role}
      </Text>
      <Markdown>{content}</Markdown>
    </Box>
  );
}

function TerminalChatResponseToolCall({
  message,
}: {
  message: ChatCompletionMessageToolCall;
}) {
  const details = parseToolCallChatCompletion(message);
  return (
    <Box flexDirection="column" gap={1}>
      <Text color="magentaBright" bold>
        command
      </Text>
      <Text>
        <Text dimColor>$</Text> {details?.cmdReadableText}
      </Text>
    </Box>
  );
}

function TerminalChatResponseToolCallOutput({
  content,
  fullStdout,
}: {
  content: string;
  fullStdout: boolean;
}) {
  const { output, metadata } = parseToolCallOutput(content);
  const { exit_code, duration_seconds } = metadata;
  const metadataInfo = useMemo(
    () =>
      [
        typeof exit_code !== "undefined" ? `code: ${exit_code}` : "",
        typeof duration_seconds !== "undefined"
          ? `duration: ${duration_seconds}s`
          : "",
      ]
        .filter(Boolean)
        .join(", "),
    [exit_code, duration_seconds],
  );
  let displayedContent = output;
  if (!fullStdout) {
    const lines = displayedContent.split("\n");
    if (lines.length > 4) {
      const head = lines.slice(0, 4);
      const remaining = lines.length - 4;
      displayedContent = [...head, `... (${remaining} more lines)`].join("\n");
    }
  }

  // -------------------------------------------------------------------------
  // Colorize diff output: lines starting with '-' in red, '+' in green.
  // This makes patches and other diff‑like stdout easier to read.
  // We exclude the typical diff file headers ('---', '+++') so they retain
  // the default color. This is a best‑effort heuristic and should be safe for
  // non‑diff output – only the very first character of a line is inspected.
  // -------------------------------------------------------------------------
  const colorizedContent = displayedContent
    .split("\n")
    .map((line) => {
      if (line.startsWith("+") && !line.startsWith("++")) {
        return chalk.green(line);
      }
      if (line.startsWith("-") && !line.startsWith("--")) {
        return chalk.red(line);
      }
      return line;
    })
    .join("\n");
  return (
    <Box flexDirection="column" gap={1}>
      <Text color="magenta" bold>
        command.stdout{" "}
        <Text dimColor>{metadataInfo ? `(${metadataInfo})` : ""}</Text>
      </Text>
      <Text dimColor>{colorizedContent}</Text>
    </Box>
  );
}

export function TerminalChatResponseGenericMessage({
  message,
}: {
  message: ChatCompletionMessageParam;
}): React.ReactElement {
  // For generic messages, we'll just stringify and show the content
  return <Text>{JSON.stringify(message, null, 2)}</Text>;
}

export type MarkdownProps = TerminalRendererOptions & {
  children: string;
};

export function Markdown({
  children,
  ...options
}: MarkdownProps): React.ReactElement {
  const size = useTerminalSize();

  const rendered = React.useMemo(() => {
    // Configure marked for this specific render
    setOptions({
      // @ts-expect-error missing parser, space props
      renderer: new TerminalRenderer({ ...options, width: size.columns }),
    });
    const parsed = parse(children, { async: false }).trim();

    // Remove the truncation logic
    return parsed;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options is an object of primitives
  }, [children, size.columns, size.rows]);

  return <Text>{rendered}</Text>;
}
