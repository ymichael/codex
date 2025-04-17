import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

/**
 * Roughly estimate the number of language‑model tokens represented by a list
 * of OpenAI `ResponseItem`s.
 *
 * A full tokenizer would be more accurate, but would add a heavyweight
 * dependency for only marginal benefit. Empirically, assuming ~4 characters
 * per token offers a good enough signal for displaying context‑window usage
 * to the user.
 *
 * The algorithm counts characters from the different content types we may
 * encounter and then converts that char count to tokens by dividing by four
 * and rounding up.
 */
export function approximateTokensUsed(
  items: Array<ChatCompletionMessageParam>,
): number {
  let charCount = 0;

  for (const item of items) {
    if (typeof item.content === "string") {
      charCount += item.content.length;
    }
    if (Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part.type === "text") {
          charCount += part.text.length;
        }
        if (part.type === "refusal") {
          charCount += part.refusal.length;
        }
      }
    }
    if ("tool_calls" in item && item.tool_calls) {
      for (const toolCall of item.tool_calls) {
        charCount += toolCall.function.name.length;
        charCount += toolCall.function.arguments.length;
      }
    }
  }

  return Math.ceil(charCount / 4);
}
