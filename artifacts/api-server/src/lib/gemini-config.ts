const DEFAULT_MODELS = ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.5-flash"];

// Ordered list of models to try. The first is preferred; the rest are fallbacks used
// when a model is busy, out of quota, or no longer available.
export function getModelChain(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.GEMINI_MODELS ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_MODELS;
}

// A target is one model on one API key, written "model@keyIndex". Quotas are per key and per
// model, so the order tries the preferred model on every key before settling for a weaker one.
export function buildTargets(models: string[], keyCount: number): string[] {
  return models.flatMap((model) => Array.from({ length: Math.max(1, keyCount) }, (_, key) => `${model}@${key}`));
}

export function parseTarget(target: string): { model: string; keyIndex: number } {
  const at = target.lastIndexOf("@");
  return { model: target.slice(0, at), keyIndex: Number(target.slice(at + 1)) };
}
