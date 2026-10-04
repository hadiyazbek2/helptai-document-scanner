export type FailureKind =
  | "transient"
  | "rate_limit"
  | "daily_quota"
  | "gone"
  | "invalid_output"
  | "blocked"
  | "fatal";

export class InvalidOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOutputError";
  }
}

// The model refused to return text (for example a RECITATION stop on published text).
// This is deterministic for a given input, so retrying the same model does not help.
export class BlockedOutputError extends Error {
  constructor(public reason: string) {
    super(`Model declined to produce output: ${reason}`);
    this.name = "BlockedOutputError";
  }
}

export class AllModelsFailedError extends Error {
  constructor(public failures: Array<{ model: string; kind: FailureKind }>) {
    super(
      `All Gemini models failed: ${failures.map((f) => `${f.model}=${f.kind}`).join(", ")}`,
    );
    this.name = "AllModelsFailedError";
  }
}

export function classifyGeminiError(error: unknown): FailureKind {
  if (error instanceof InvalidOutputError) return "invalid_output";
  if (error instanceof BlockedOutputError) return "blocked";
  const value = (error ?? {}) as { status?: unknown; message?: unknown };
  const status = Number(value.status);
  const message = typeof value.message === "string" ? value.message : "";

  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(message)) {
    return /PerDay|per day/i.test(message) ? "daily_quota" : "rate_limit";
  }
  if (status === 404 || /no longer available|not found/i.test(message)) return "gone";
  if (
    status === 500 ||
    status === 503 ||
    status === 504 ||
    /high demand|unavailable|overloaded|temporarily/i.test(message)
  ) {
    return "transient";
  }
  return "fatal";
}

// How long to skip a model after it reports it is out of quota or retired.
const COOLDOWN_MS: Partial<Record<FailureKind, number>> = {
  daily_quota: 30 * 60_000,
  rate_limit: 60_000,
  gone: 60 * 60_000,
};
const cooldowns = new Map<string, number>();

export function resetModelCooldowns() {
  cooldowns.clear();
}

export type FallbackEvent = { model: string; kind: FailureKind; attempt: number; error: unknown };

type Options = {
  attemptsPerModel?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onEvent?: (event: FallbackEvent) => void;
};

// Runs `run` against each model in turn. Busy models are retried with backoff; models that
// are out of quota or retired are skipped immediately (and remembered for a while).
export async function runWithModelFallback<T>(
  models: string[],
  run: (model: string) => Promise<T>,
  options: Options = {},
): Promise<{ result: T; model: string }> {
  const {
    attemptsPerModel = 3,
    baseDelayMs = 1500,
    sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    onEvent,
  } = options;
  const failures: Array<{ model: string; kind: FailureKind }> = [];

  for (const model of models) {
    if ((cooldowns.get(model) ?? 0) > now()) continue;

    let lastKind: FailureKind = "transient";
    for (let attempt = 0; attempt < attemptsPerModel; attempt += 1) {
      try {
        return { result: await run(model), model };
      } catch (error) {
        lastKind = classifyGeminiError(error);
        onEvent?.({ model, kind: lastKind, attempt, error });
        if (lastKind === "fatal") throw error;
        const cooldown = COOLDOWN_MS[lastKind];
        if (cooldown) {
          cooldowns.set(model, now() + cooldown);
          break;
        }
        if (lastKind === "blocked") break;
        // transient or invalid_output: retry this model after a short wait
        if (attempt < attemptsPerModel - 1) await sleep(baseDelayMs * 2 ** attempt);
      }
    }
    failures.push({ model, kind: lastKind });
  }

  // Every model was skipped by cooldown without being tried this time.
  if (!failures.length) {
    throw new AllModelsFailedError(models.map((model) => ({ model, kind: "daily_quota" as const })));
  }
  throw new AllModelsFailedError(failures);
}
