import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { ZodType } from "zod";
import { ProviderError } from "../../errors";
import { llmPricing } from "../models";
import type { AiCallContext, LlmProvider, StructuredRequest, StructuredResult } from "../types";

/**
 * Models that accept the server-side refusal fallback. Claude Haiku 5.5 has
 * none (a declined request simply stays declined), so it is sent without one.
 */
const SERVER_FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

/**
 * Claude adapter (official Anthropic SDK). Structured output uses
 * `output_config.format` with a zod schema; where the model supports it,
 * server-side refusal fallbacks retry a policy decline on the fallback model.
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly isDemo = false;
  readonly id = "anthropic";
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 5 * 60_000 });
  }

  async generateStructured<T>(req: StructuredRequest<T>, ctx: AiCallContext): Promise<StructuredResult<T>> {
    try {
      const response = await this.client.beta.messages.parse(
        {
          model: this.model,
          max_tokens: req.maxTokens ?? 16000,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
          ...(SERVER_FALLBACK_MODELS.has(this.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          output_config: { format: betaZodOutputFormat(req.schema as ZodType), effort: "medium" },
        },
        { signal: ctx.signal },
      );
      if (response.stop_reason === "refusal") {
        throw new ProviderError("anthropic", "the model declined to analyze this text", { retryable: false, code: "provider_rejected_content" });
      }
      if (response.stop_reason === "max_tokens") {
        throw new ProviderError("anthropic", "output truncated (max_tokens)", { retryable: true, code: "analysis_failed" });
      }
      const parsed = response.parsed_output as T | null;
      if (!parsed) throw new ProviderError("anthropic", "structured output missing", { retryable: true, code: "analysis_failed" });
      const inputTokens = response.usage.input_tokens ?? 0;
      const outputTokens = response.usage.output_tokens ?? 0;
      const price = llmPricing("anthropic", this.model);
      return {
        data: parsed,
        inputTokens,
        outputTokens,
        costUsd: price ? (inputTokens * price.inputPerMTokUsd + outputTokens * price.outputPerMTokUsd) / 1e6 : 0,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
        throw new ProviderError("anthropic", err.message, { retryable: true, cause: err });
      }
      if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new ProviderError("anthropic", err.message, { retryable: false, code: "provider_unavailable", cause: err });
      }
      if (err instanceof Anthropic.APIError) {
        throw new ProviderError("anthropic", err.message, { retryable: (err.status ?? 500) >= 500, cause: err });
      }
      throw new ProviderError("anthropic", (err as Error).message, { retryable: true, code: "analysis_failed", cause: err });
    }
  }
}
