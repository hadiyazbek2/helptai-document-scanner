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

// The model did not answer in time. Under heavy load Google sometimes holds a request for
// minutes before failing it, so we stop waiting and move on to the next model.
export class GeminiTimeoutError extends Error {
  constructor(public ms: number) {
    super(`Model did not answer within ${Math.round(ms / 1000)} s`);
    this.name = "GeminiTimeoutError";
  }
}

// The user cancelled (closed the request); no further attempts are made.
export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
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
  if (error instanceof GeminiTimeoutError) return "transient";
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
// Groups (models) that answered "busy" recently. They are tried last for a while rather than
// skipped: on the free tier every attempt counts against the daily request limit, busy or not.
const recentlyBusy = new Map<string, number>();
const BUSY_MEMORY_MS = 2 * 60_000;

export function resetModelCooldowns() {
  cooldowns.clear();
  recentlyBusy.clear();
}

export type FallbackEvent = { model: string; kind: FailureKind; attempt: number; error: unknown };

type Options = {
  attemptsPerModel?: number;
  // Targets in the same group share one budget of busy answers: "high demand" is about the model,
  // not the API key, so once a model has been busy `busyPerGroup` times its other keys are skipped.
  groupOf?: (target: string) => string;
  busyPerGroup?: number;
  // Stops further attempts when aborted (the user cancelled).
  signal?: AbortSignal;
  // Called just before each attempt, for progress messages.
  onStart?: (target: string) => void;
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
    groupOf = (target) => target,
    busyPerGroup = Infinity,
    signal,
    onStart,
    baseDelayMs = 1500,
    sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    onEvent,
  } = options;
  const failures: Array<{ model: string; kind: FailureKind }> = [];
  const busyCount = new Map<string, number>();
  const busyLately = (target: string) => (recentlyBusy.get(groupOf(target)) ?? 0) > now();
  const ordered = [...models.filter((target) => !busyLately(target)), ...models.filter(busyLately)];

  for (const model of ordered) {
    if ((cooldowns.get(model) ?? 0) > now()) continue;
    const group = groupOf(model);
    if ((busyCount.get(group) ?? 0) >= busyPerGroup) {
      failures.push({ model, kind: "transient" });
      continue;
    }

    let lastKind: FailureKind = "transient";
    for (let attempt = 0; attempt < attemptsPerModel; attempt += 1) {
      if (signal?.aborted) throw new CancelledError();
      onStart?.(model);
      try {
        const result = await run(model);
        recentlyBusy.delete(group);
        return { result, model };
      } catch (error) {
        if (signal?.aborted) throw new CancelledError();
        lastKind = classifyGeminiError(error);
        onEvent?.({ model, kind: lastKind, attempt, error });
        if (lastKind === "fatal") throw error;
        const cooldown = COOLDOWN_MS[lastKind];
        if (cooldown) {
          cooldowns.set(model, now() + cooldown);
          break;
        }
        if (lastKind === "blocked") break;
        if (lastKind === "transient") {
          busyCount.set(group, (busyCount.get(group) ?? 0) + 1);
          recentlyBusy.set(group, now() + BUSY_MEMORY_MS);
          // A request that hung until our time limit is not worth repeating on the same model.
          if (error instanceof GeminiTimeoutError || (busyCount.get(group) ?? 0) >= busyPerGroup) break;
        }
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
