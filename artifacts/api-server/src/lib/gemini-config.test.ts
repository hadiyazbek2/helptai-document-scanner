import { describe, expect, it } from "vitest";
import { buildTargets, getModelChain, parseTarget } from "./gemini-config";

describe("gemini config", () => {
  it("reads the model list from the environment, with defaults", () => {
    expect(getModelChain({ GEMINI_MODELS: " a , b ,," } as NodeJS.ProcessEnv)).toEqual(["a", "b"]);
    expect(getModelChain({} as NodeJS.ProcessEnv)[0]).toBe("gemini-3.6-flash");
  });

  it("tries the preferred model on every key before the next model", () => {
    expect(buildTargets(["a", "b"], 2)).toEqual(["a@0", "a@1", "b@0", "b@1"]);
    expect(buildTargets(["a"], 0)).toEqual(["a@0"]);
  });

  it("parses a target back into model and key", () => {
    expect(parseTarget("gemini-3.6-flash@2")).toEqual({ model: "gemini-3.6-flash", keyIndex: 2 });
  });
});
