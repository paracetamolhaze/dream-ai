import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ProviderError } from "../../errors";
import { fetchJson } from "../http";
import { llmPricing, type SttModelSpec } from "../models";
import type {
  AiCallContext,
  ImageModelSpec,
  ImageProvider,
  ImageRequest,
  ImageResult,
  LlmProvider,
  StructuredRequest,
  StructuredResult,
  SttInput,
  SttProvider,
  SttResult,
} from "../types";

/**
 * Adapters for the OpenAI REST API and any server that implements the same
 * endpoints (Groq, OpenRouter, LocalAI, faster-whisper-server/speaches…).
 * Only documented endpoints are used:
 *   POST /audio/transcriptions, POST /chat/completions,
 *   POST /images/generations, POST /images/edits
 */

interface Conn {
  baseUrl: string;
  apiKey?: string;
}

function headers(conn: Conn): Record<string, string> {
  return conn.apiKey ? { authorization: `Bearer ${conn.apiKey}` } : {};
}

const url = (conn: Conn, p: string) => `${conn.baseUrl.replace(/\/$/, "")}${p}`;

export class OpenAiSttProvider implements SttProvider {
  readonly isDemo = false;
  readonly id = "openai";
  constructor(
    private readonly conn: Conn,
    private readonly spec: SttModelSpec | { model: string; verboseJson: boolean; costPerMinuteUsd: number },
  ) {}
  get model() {
    return this.spec.model;
  }

  async transcribe(input: SttInput, ctx: AiCallContext): Promise<SttResult> {
    const data = await readFile(input.filePath);
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(data)], { type: input.mime }), input.fileName);
    form.set("model", this.spec.model);
    form.set("response_format", this.spec.verboseJson ? "verbose_json" : "json");
    // gpt-transcribe takes `languages` instead of `language`; it detects the language itself, so no hint is sent.
    if (input.language && ("languageHint" in this.spec ? this.spec.languageHint !== false : true)) form.set("language", input.language);
    const res = await fetchJson<{ text?: string; language?: string; languages?: unknown[]; duration?: number }>("openai-stt", url(this.conn, "/audio/transcriptions"), {
      form,
      headers: headers(this.conn),
      timeoutMs: 10 * 60_000,
      signal: ctx.signal,
    });
    const text = (res?.text ?? "").trim();
    const durationSec = res?.duration ?? input.durationSec;
    return {
      text,
      language: normalizeLanguage(res?.language ?? (typeof res?.languages?.[0] === "string" ? res.languages[0] : undefined)) ?? input.language,
      durationSec,
      costUsd: ((durationSec ?? 60) / 60) * this.spec.costPerMinuteUsd,
    };
  }
}

function normalizeLanguage(l?: string): string | undefined {
  if (!l) return undefined;
  const s = l.toLowerCase();
  if (s === "russian" || s.startsWith("ru")) return "ru";
  if (s === "english" || s.startsWith("en")) return "en";
  return s.slice(0, 8);
}

/** Recursively makes a JSON schema acceptable for `strict` structured outputs. */
function strictify(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictify);
  if (!schema || typeof schema !== "object") return schema;
  const s = { ...(schema as Record<string, unknown>) };
  delete s.$schema;
  if (s.type === "object" && s.properties && typeof s.properties === "object") {
    s.additionalProperties = false;
    s.required = Object.keys(s.properties as object);
    s.properties = Object.fromEntries(Object.entries(s.properties as Record<string, unknown>).map(([k, v]) => [k, strictify(v)]));
  }
  if (s.items) s.items = strictify(s.items);
  for (const key of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(s[key])) s[key] = (s[key] as unknown[]).map(strictify);
  for (const key of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format"]) delete s[key];
  return s;
}

export class OpenAiLlmProvider implements LlmProvider {
  readonly isDemo = false;
  readonly id = "openai";
  constructor(
    private readonly conn: Conn,
    readonly model: string,
  ) {}

  async generateStructured<T>(req: StructuredRequest<T>, ctx: AiCallContext): Promise<StructuredResult<T>> {
    const jsonSchema = strictify(z.toJSONSchema(req.schema as z.ZodType));
    const messages: { role: string; content: string }[] = [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ];
    let totalIn = 0;
    let totalOut = 0;
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const body = {
        model: this.model,
        messages: attempt === 0 ? messages : [...messages, { role: "user", content: `Your previous output did not match the schema: ${lastError}. Return only valid JSON.` }],
        max_completion_tokens: req.maxTokens ?? 8000,
        response_format: { type: "json_schema", json_schema: { name: req.schemaName, schema: jsonSchema, strict: true } },
      };
      const res = await fetchJson<{
        choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      }>("openai-llm", url(this.conn, "/chat/completions"), { body, headers: headers(this.conn), timeoutMs: 180_000, signal: ctx.signal });
      totalIn += res.usage?.prompt_tokens ?? 0;
      totalOut += res.usage?.completion_tokens ?? 0;
      const choice = res.choices?.[0];
      if (choice?.message?.refusal) throw new ProviderError("openai-llm", `refusal: ${choice.message.refusal}`, { retryable: false, code: "provider_rejected_content" });
      const content = choice?.message?.content ?? "";
      try {
        const parsed = req.schema.safeParse(JSON.parse(content));
        if (parsed.success) {
          const price = llmPricing("openai", this.model);
          return {
            data: parsed.data,
            inputTokens: totalIn,
            outputTokens: totalOut,
            costUsd: price ? (totalIn * price.inputPerMTokUsd + totalOut * price.outputPerMTokUsd) / 1e6 : 0,
          };
        }
        lastError = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      } catch (e) {
        lastError = `invalid JSON (${(e as Error).message})`;
      }
    }
    throw new ProviderError("openai-llm", `structured output invalid: ${lastError}`, { retryable: true, code: "analysis_failed" });
  }
}

export class OpenAiImageProvider implements ImageProvider {
  readonly isDemo = false;
  constructor(
    private readonly conn: Conn,
    readonly spec: ImageModelSpec,
  ) {}

  async generate(req: ImageRequest, ctx: AiCallContext): Promise<ImageResult> {
    const input = this.spec.buildInput(req);
    type Res = { data?: { b64_json?: string; url?: string }[] };
    let res: Res;
    if (req.referenceImage?.filePath && this.spec.supportsReferenceImage) {
      const form = new FormData();
      form.set("model", this.spec.model);
      form.set("prompt", String(input.prompt));
      if (input.size) form.set("size", String(input.size));
      if (input.quality) form.set("quality", String(input.quality));
      const bytes = await readFile(req.referenceImage.filePath);
      form.append("image[]", new Blob([new Uint8Array(bytes)], { type: req.referenceImage.mime ?? "image/jpeg" }), "reference.jpg");
      res = await fetchJson<Res>("openai-image", url(this.conn, "/images/edits"), { form, headers: headers(this.conn), timeoutMs: 240_000, signal: ctx.signal });
    } else {
      res = await fetchJson<Res>("openai-image", url(this.conn, "/images/generations"), {
        body: { model: this.spec.model, ...input },
        headers: headers(this.conn),
        timeoutMs: 240_000,
        signal: ctx.signal,
      });
    }
    const item = res.data?.[0];
    if (item?.b64_json) return { bytes: Buffer.from(item.b64_json, "base64"), contentType: "image/png", costUsd: this.spec.costPerImageUsd };
    if (item?.url) return { url: item.url, costUsd: this.spec.costPerImageUsd };
    throw new ProviderError("openai-image", "no image in response", { retryable: true });
  }
}
