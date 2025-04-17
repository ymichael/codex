import chalk from "chalk";
import { AppConfig } from "./config";
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
    reportMissingAPIKey();
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

export function reportMissingAPIKey(): void {
  // eslint-disable-next-line no-console
  console.error(
    `\n${chalk.red("Missing API key.")}\n\n` +
      `Set one of the following environment variables:\n` +
      `- ${chalk.bold("OPENAI_API_KEY")} for OpenAI models\n` +
      `- ${chalk.bold("OPENROUTER_API_KEY")} for OpenRouter models\n` +
      `- ${chalk.bold(
        "GOOGLE_GENERATIVE_AI_API_KEY",
      )} for Google Gemini models\n\n` +
      `Then re-run this command.\n` +
      `You can create an OpenAI key here: ${chalk.bold(
        chalk.underline("https://platform.openai.com/account/api-keys"),
      )}\n` +
      `You can create an OpenRouter key here: ${chalk.bold(
        chalk.underline("https://openrouter.ai/settings/keys"),
      )}\n` +
      `You can create a Google Generative AI key here: ${chalk.bold(
        chalk.underline("https://aistudio.google.com/apikey"),
      )}\n`,
  );
}
