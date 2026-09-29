/**
 * Runtime AI provider-agnostic (ADR-0003, § 4.6 admin_settings: ai.provider,
 * ai.model, ai.base_url_ollama, ai.api_key cifrata). L'unico modulo che parla
 * con un provider di modelli: nessun provider hard-coded nel feature code.
 *
 * v1: superficie + implementazione OpenAI-compatible (chat completions);
 * Anthropic/Ollama completo arriva con le feature v1.1 (scan etichetta).
 */

export type AiProviderKind = "openai" | "anthropic" | "ollama";
/** 'echo' = provider interno deterministico per i test (mai network reale). */
export type ProviderIds = AiProviderKind | "echo";

export interface AiRuntimeConfig {
  provider: ProviderIds;
  model: string;
  apiKey?: string;
  baseUrl?: string; // esempio: base_url_ollama (§ 4.6)
}

export interface AiTextRequest {
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AiTextResponse {
  text: string;
  provider: ProviderIds;
  model: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Punto di ingresso unico per la generazione testuale (ADR-0003). Le impostazioni
 * dell'amministrazione arrivano come parametro (caricate da admin_settings con
 * api_key decriptata): qui nessun accesso diretto al DB.
 */
export async function runAiText(
  request: AiTextRequest,
  config: AiRuntimeConfig,
): Promise<AiTextResponse> {
  switch (config.provider) {
    case "echo":
      // Provider di test deterministico: risponde senza mai contattare la rete.
      return {
        text: `echo:${request.prompt}`,
        provider: config.provider,
        model: config.model,
      };
    case "ollama": {
      const baseUrl = config.baseUrl ?? "http://localhost:11434";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      try {
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: config.model,
            stream: false,
            messages: [
              ...(request.system ? [{ role: "system", content: request.system }] : []),
              { role: "user", content: request.prompt },
            ],
            options: { temperature: request.temperature ?? 0.2 },
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Ollama: HTTP ${response.status}`);
        }
        const json = (await response.json()) as { message?: { content?: string } };
        return {
          text: json.message?.content ?? "",
          provider: config.provider,
          model: config.model,
        };
      } finally {
        clearTimeout(timer);
      }
    }
    case "openai":
    case "anthropic": {
      // OpenAI-compatible chat completions (OpenAI nativo o endpoint compatibile).
      const baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey ?? ""}`,
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: request.maxTokens ?? 512,
            temperature: request.temperature ?? 0.2,
            messages: [
              ...(request.system ? [{ role: "system", content: request.system }] : []),
              { role: "user", content: request.prompt },
            ],
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`AI provider ${config.provider}: HTTP ${response.status}`);
        }
        const json = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        return {
          text: json.choices?.[0]?.message?.content ?? "",
          provider: config.provider,
          model: config.model,
        };
      } finally {
        clearTimeout(timer);
      }
    }
    default: {
      const never: never = config.provider;
      throw new Error(`Provider AI non supportato: ${String(never)}`);
    }
  }
}