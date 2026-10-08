import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AllModelsFailedError,
  BlockedOutputError,
  GeminiTimeoutError,
  InvalidOutputError,
  classifyGeminiError,
  resetModelCooldowns,
  runWithModelFallback,
} from "./gemini-call";

const err = (status: number, message: string) => Object.assign(new Error(message), { status });
const busy = () => err(503, "This model is currently experiencing high demand.");
const dailyQuota = () =>
  err(429, "Quota exceeded ... GenerateRequestsPerDayPerProjectPerModel-FreeTier");
const noSleep = { sleep: async () => {} };

beforeEach(() => resetModelCooldowns());

describe("classifyGeminiError", () => {
  it("separates daily quota from per-minute rate limits", () => {
    expect(classifyGeminiError(dailyQuota())).toBe("daily_quota");
    expect(classifyGeminiError(err(429, "RESOURCE_EXHAUSTED per minute"))).toBe("rate_limit");
  });
  it("recognises busy, retired and invalid-output failures", () => {
    expect(classifyGeminiError(busy())).toBe("transient");
    expect(classifyGeminiError(err(404, "no longer available to new users"))).toBe("gone");
    expect(classifyGeminiError(new InvalidOutputError("x"))).toBe("invalid_output");
    expect(classifyGeminiError(new BlockedOutputError("RECITATION"))).toBe("blocked");
    expect(classifyGeminiError(err(400, "bad request"))).toBe("fatal");
  });
});

describe("runWithModelFallback", () => {
  it("returns the first model's result when it works", async () => {
    const run = vi.fn().mockResolvedValue("ok");
    expect(await runWithModelFallback(["a", "b"], run, noSleep)).toEqual({ result: "ok", model: "a" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries a busy model with backoff before giving up on it", async () => {
    const sleep = vi.fn(async () => {});
    const run = vi.fn().mockRejectedValueOnce(busy()).mockResolvedValue("ok");
    const out = await runWithModelFallback(["a"], run, { sleep, baseDelayMs: 100 });
    expect(out.model).toBe("a");
    expect(sleep).toHaveBeenCalledWith(100);
  });

  it("moves to the next model after repeated busy responses", async () => {
    const run = vi.fn(async (model: string) => {
      if (model === "a") throw busy();
      return "from-b";
    });
    const out = await runWithModelFallback(["a", "b"], run, noSleep);
    expect(out).toEqual({ result: "from-b", model: "b" });
    expect(run.mock.calls.filter(([m]) => m === "a")).toHaveLength(3);
  });

  it("skips a quota-exhausted model immediately and remembers it", async () => {
    const run = vi.fn(async (model: string) => {
      if (model === "a") throw dailyQuota();
      return "from-b";
    });
    await runWithModelFallback(["a", "b"], run, noSleep);
    await runWithModelFallback(["a", "b"], run, noSleep);
    expect(run.mock.calls.filter(([m]) => m === "a")).toHaveLength(1);
  });

  it("does not retry a blocked (RECITATION) model, and moves straight on", async () => {
    const run = vi.fn(async (model: string) => {
      if (model === "a") throw new BlockedOutputError("RECITATION");
      return "from-b";
    });
    const out = await runWithModelFallback(["a", "b"], run, noSleep);
    expect(out.model).toBe("b");
    expect(run.mock.calls.filter(([m]) => m === "a")).toHaveLength(1);
  });

  it("does not retry fatal errors", async () => {
    const run = vi.fn().mockRejectedValue(err(400, "invalid argument"));
    await expect(runWithModelFallback(["a", "b"], run, noSleep)).rejects.toThrow("invalid argument");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports every failure when no model works", async () => {
    const run = vi.fn(async (model: string) => {
      throw model === "a" ? dailyQuota() : busy();
    });
    const error = await runWithModelFallback(["a", "b"], run, noSleep).catch((e) => e);
    expect(error).toBeInstanceOf(AllModelsFailedError);
    expect(error.failures).toEqual([
      { model: "a", kind: "daily_quota" },
      { model: "b", kind: "transient" },
    ]);
  });

  it("after a model's busy budget, skips its other keys and moves to the next model", async () => {
    const run = vi.fn(async (target: string) => {
      if (target.startsWith("a@")) throw busy();
      return "ok";
    });
    const out = await runWithModelFallback(["a@0", "a@1", "b@0"], run, { ...noSleep, groupOf: (t) => t.split("@")[0], busyPerGroup: 2 });
    expect(out.model).toBe("b@0");
    expect(run.mock.calls.map(([t]) => t)).toEqual(["a@0", "a@0", "b@0"]);
  });

  it("does not repeat an attempt that hit the time limit", async () => {
    const run = vi.fn(async (model: string) => {
      if (model === "a") throw new GeminiTimeoutError(1000);
      return "from-b";
    });
    const out = await runWithModelFallback(["a", "b"], run, noSleep);
    expect(out.model).toBe("b");
    expect(run.mock.calls.filter(([m]) => m === "a")).toHaveLength(1);
    expect(classifyGeminiError(new GeminiTimeoutError(1000))).toBe("transient");
  });

  it("tries a model that was busy a moment ago last on the next request, then forgets after a while", async () => {
    let clock = 0;
    const now = () => clock;
    const seen: string[] = [];
    const run = vi.fn(async (model: string) => {
      seen.push(model);
      if (model === "a" && clock === 0) throw busy();
      return model;
    });
    const options = { ...noSleep, now, busyPerGroup: 1 };
    expect((await runWithModelFallback(["a", "b"], run, options)).model).toBe("b");
    clock = 1000;
    expect((await runWithModelFallback(["a", "b"], run, options)).model).toBe("b");
    clock = 3 * 60_000;
    expect((await runWithModelFallback(["a", "b"], run, options)).model).toBe("a");
    expect(seen).toEqual(["a", "b", "b", "a"]);
  });
});
