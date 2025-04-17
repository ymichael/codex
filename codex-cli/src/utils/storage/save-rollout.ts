/* eslint-disable no-console */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import { loadInstructions } from "../config";
import fs from "fs/promises";
import os from "os";
import path from "path";

const SESSIONS_ROOT = path.join(os.homedir(), ".codex", "sessions");

async function saveRolloutToHomeSessions(
  items: Array<ChatCompletionMessageParam>,
): Promise<void> {
  await fs.mkdir(SESSIONS_ROOT, { recursive: true });

  const sessionId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const ts = timestamp.replace(/[:.]/g, "-").slice(0, 10);
  const filename = `rollout-${ts}-${sessionId}.json`;
  const filePath = path.join(SESSIONS_ROOT, filename);
  const instructions = loadInstructions();
  try {
    await fs.writeFile(
      filePath,
      JSON.stringify(
        {
          session: {
            timestamp,
            id: sessionId,
            instructions,
          },
          items,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (error) {
    console.error(`Failed to save rollout to ${filePath}: `, error);
  }
}

let debounceTimer: NodeJS.Timeout | null = null;
let pendingItems: Array<ChatCompletionMessageParam> | null = null;

export function saveRollout(items: Array<ChatCompletionMessageParam>): void {
  pendingItems = items;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    if (pendingItems) {
      saveRolloutToHomeSessions(pendingItems).catch(() => {});
      pendingItems = null;
    }
    debounceTimer = null;
  }, 2000);
}
