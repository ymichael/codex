import type { AppConfig } from "./config";

import chalk from "chalk";
import OpenAI from "openai";

const MODEL_LIST_TIMEOUT_MS = 2_000; // 2 seconds
export const RECOMMENDED_MODELS: Array<string> = ["o4-mini", "o3"];

/**
 * Background model loader / cache.
 *
 * We start fetching the list of available models from OpenAI once the CLI
 * enters interactive mode.  The request is made exactly once during the
 * lifetime of the process and the results are cached for subsequent calls.
 */

let modelsPromise: Promise<Array<string>> | null = null;

async function fetchModels(config: AppConfig): Promise<Array<string>> {
  // If the user has not configured an API key we cannot hit the network.
  if (!config.apiKey) {
    return [];
  }
  try {
    const openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    const list = await openai.models.list();
    const models: Array<string> = [];
    for await (const model of list as AsyncIterable<{ id?: string }>) {
      if (model && typeof model.id === "string") {
        models.push(model.id);
      }
    }
    return models.sort();
  } catch {
    return [];
  }
}

export function preloadModels(config: AppConfig): void {
  if (!modelsPromise) {
    // Fire‑and‑forget – callers that truly need the list should `await`
    // `getAvailableModels()` instead.
    void getAvailableModels(config);
  }
}

export async function getAvailableModels(
  config: AppConfig,
): Promise<Array<string>> {
  if (!modelsPromise) {
    modelsPromise = fetchModels(config);
  }
  return modelsPromise;
}

/**
 * Verify that the provided model identifier is present in the set returned by
 * {@link getAvailableModels}. The list of models is fetched from the OpenAI
 * `/models` endpoint the first time it is required and then cached in‑process.
 */
export async function isModelSupported(
  model: string | undefined | null,
  config: AppConfig,
): Promise<boolean> {
  if (
    typeof model !== "string" ||
    model.trim() === "" ||
    RECOMMENDED_MODELS.includes(model)
  ) {
    return true;
  }

  try {
    const models = await Promise.race<Array<string>>([
      getAvailableModels(config),
      new Promise<Array<string>>((resolve) =>
        setTimeout(() => resolve([]), MODEL_LIST_TIMEOUT_MS),
      ),
    ]);

    // If the timeout fired we get an empty list → treat as supported to avoid
    // false negatives.
    if (models.length === 0) {
      return true;
    }

    return models.includes(model.trim());
  } catch {
    // Network or library failure → don't block start‑up.
    return true;
  }
}

export function reportMissingAPIKeyForProvider(provider: string): void {
  // eslint-disable-next-line no-console
  console.error(
    (provider
      ? `\n${chalk.red("Missing API key for provider:")} ${provider}\n\n`
      : `\n${chalk.red("Missing API key:")}\n\n`) +
      (provider
        ? `Please set the following environment variable:\n`
        : "Please set one of the following environment variables:\n") +
      (() => {
        switch (provider) {
          case "openai":
            return `- ${chalk.bold("OPENAI_API_KEY")} for OpenAI models\n`;
          case "openrouter":
            return `- ${chalk.bold(
              "OPENROUTER_API_KEY",
            )} for OpenRouter models\n`;
          case "gemini":
            return `- ${chalk.bold(
              "GOOGLE_GENERATIVE_AI_API_KEY",
            )} for Google Gemini models\n`;
          case "xai":
            return `- ${chalk.bold("XAI_API_KEY")} for xAI models\n`;
          default:
            return (
              [
                `- ${chalk.bold("OPENAI_API_KEY")} for OpenAI models`,
                `- ${chalk.bold("OPENROUTER_API_KEY")} for OpenRouter models`,
                `- ${chalk.bold(
                  "GOOGLE_GENERATIVE_AI_API_KEY",
                )} for Google Gemini models`,
                `- ${chalk.bold("XAI_API_KEY")} for xAI models`,
              ].join("\n") + "\n"
            );
        }
      })() +
      `Then re-run this command.\n` +
      (() => {
        switch (provider) {
          case "openai":
            return `You can create an OpenAI key here: ${chalk.bold(
              chalk.underline("https://platform.openai.com/account/api-keys"),
            )}\n`;
          case "openrouter":
            return `You can create an OpenRouter key here: ${chalk.bold(
              chalk.underline("https://openrouter.ai/settings/keys"),
            )}\n`;
          case "gemini":
            return `You can create a Google Generative AI key here: ${chalk.bold(
              chalk.underline("https://aistudio.google.com/apikey"),
            )}\n`;
          case "xai":
            return `You can create an xAI key here: ${chalk.bold(
              chalk.underline("https://console.x.ai/team/default/api-keys"),
            )}\n`;
          default:
            return "";
        }
      })(),
  );
}
