---
name: Gemini model availability
description: Notes on selecting a Gemini model for provider-key based server calls.
---

The provider-key based document analysis path should use a currently available model rather than assuming older model names remain enabled for new API users.

**Why:** A smoke request showed that `gemini-2.5-flash` can return a 404 for new users even when the API key is valid; the provider error named the current replacement.

**How to apply:** If Gemini returns a model-not-found response, read the provider's error and update the server-side model configuration before debugging request payloads or credentials. Treat 429/503 high-demand responses as transient and retry briefly before showing a retry action in the UI.