import type { TerminalHeaderProps } from "./terminal-header.js";
import type { GroupedResponseItem } from "./use-message-grouping.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import TerminalChatResponseItem from "./terminal-chat-response-item.js";
import TerminalHeader from "./terminal-header.js";
import { Box, Static, Text } from "ink";
import React, { useMemo } from "react";

// A batch entry can either be a standalone response item or a grouped set of
// items (e.g. auto‑approved tool‑call batches) that should be rendered
// together.
type BatchEntry = {
  item?: ChatCompletionMessageParam;
  group?: GroupedResponseItem;
};
type MessageHistoryProps = {
  batch: Array<BatchEntry>;
  groupCounts: Record<string, number>;
  items: Array<ChatCompletionMessageParam>;
  userMsgCount: number;
  confirmationPrompt: React.ReactNode;
  loading: boolean;
  thinkingSeconds: number;
  headerProps: TerminalHeaderProps;
  fullStdout: boolean;
};

const MessageHistory: React.FC<MessageHistoryProps> = ({
  batch,
  headerProps,
  loading,
  thinkingSeconds,
  fullStdout,
}) => {
  const [messages, debug] = useMemo(
    () => [batch.map(({ item }) => item!), process.env["DEBUG"]],
    [batch],
  );

  return (
    <Box flexDirection="column">
      {loading && debug && (
        <Box marginTop={1}>
          <Text color="yellow">{`(${thinkingSeconds}s)`}</Text>
        </Box>
      )}
      <Static items={["header", ...messages]}>
        {(item, index) => {
          if (item === "header") {
            return <TerminalHeader key="header" {...headerProps} />;
          }
          const message = item as ChatCompletionMessageParam;
          return (
            <Box
              key={index}
              flexDirection="column"
              marginLeft={message.role === "user" ? 0 : 4}
              marginTop={message.role === "user" ? 0 : 1}
            >
              <TerminalChatResponseItem
                item={message}
                fullStdout={fullStdout}
              />
            </Box>
          );
        }}
      </Static>
    </Box>
  );
};

export default React.memo(MessageHistory);
