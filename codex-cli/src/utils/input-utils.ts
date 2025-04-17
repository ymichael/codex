import type {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions.mjs";

import { fileTypeFromBuffer } from "file-type";
import fs from "fs/promises";

export async function createInputItem(
  text: string,
  images: Array<string>,
): Promise<ChatCompletionMessageParam> {
  const content: Array<ChatCompletionContentPart> = [{ type: "text", text }];

  for (const filePath of images) {
    /* eslint-disable no-await-in-loop */
    const binary = await fs.readFile(filePath);
    const kind = await fileTypeFromBuffer(binary);
    /* eslint-enable no-await-in-loop */
    const encoded = binary.toString("base64");
    const mime = kind?.mime ?? "application/octet-stream";
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${mime};base64,${encoded}`,
      },
    });
  }
  const inputItem: ChatCompletionMessageParam = {
    role: "user",
    content: [{ type: "text", text }],
  };
  return inputItem;
}
