import type {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions.mjs";

import { fileTypeFromBuffer } from "file-type";
import fs from "fs/promises";
import path from "path";

export async function createInputItem(
  text: string,
  images: Array<string>,
): Promise<ChatCompletionMessageParam> {
  const content: Array<ChatCompletionContentPart> = [{ type: "text", text }];

  for (const filePath of images) {
    try {
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
    } catch (err) {
      content.push({
        type: "text",
        text: `[missing image: ${path.basename(filePath)}]`,
      });
    }
  }
  const inputItem: ChatCompletionMessageParam = {
    role: "user",
    content,
  };
  return inputItem;
}
