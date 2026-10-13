export class GeminiService {
  /**
   * Proxies UPC extraction to the secure server backend.
   */
  async extractUPC(
    base64Image: string,
    _onRetry?: (attempt: number, delayMs: number) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const response = await fetch('/api/gemini/extract-upc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ base64Image }),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(formatServerError(response.status, errorData.error));
    }

    const data = await response.json();
    return data.upc;
  }

  /**
   * Proxies professional studio shot conversion to the secure server backend.
   */
  async transformToStudioShot(
    base64Image: string,
    _onRetry?: (attempt: number, delayMs: number) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const response = await fetch('/api/gemini/transform-studio-shot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ base64Image }),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(formatServerError(response.status, errorData.error));
    }

    const data = await response.json();
    return data.studioImage;
  }

  /**
   * Proxies audio transcription and product detail extraction (title & description) to Gemini,
   * combining voice audio, product photo and UPC to validate and generate accurate catalog details.
   */
  async processAudio(
    base64Audio: string,
    mimeType: string = 'audio/webm',
    base64Image?: string | null,
    upcCode?: string | null,
    signal?: AbortSignal
  ): Promise<{ transcription: string; title: string; description: string }> {
    const response = await fetch('/api/gemini/process-audio', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ base64Audio, mimeType, base64Image, upcCode }),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(formatServerError(response.status, errorData.error));
    }

    return await response.json();
  }
}

function formatServerError(status: number, rawError?: string): string {
  if (status === 504) {
    return "El servidor tardó más de lo esperado (504 Gateway Timeout). Puedes reintentar o usar la opción manual/directa.";
  }
  if (status === 503) {
    return "Alta demanda momentánea en la IA (503). Por favor reintenta en unos segundos o usa la opción directa.";
  }
  if (rawError) {
    try {
      const parsed = JSON.parse(rawError);
      if (parsed?.error?.message) return parsed.error.message;
    } catch {}
    return rawError;
  }
  return `Error del servidor (${status})`;
}

export const geminiService = new GeminiService();
