export class GeminiService {
  /**
   * Proxies UPC extraction to the secure server backend.
   */
  async extractUPC(
    base64Image: string,
    _onRetry?: (attempt: number, delayMs: number) => void
  ): Promise<string> {
    const response = await fetch('/api/gemini/extract-upc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ base64Image }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Error del servidor (${response.status})`);
    }

    const data = await response.json();
    return data.upc;
  }

  /**
   * Proxies professional studio shot conversion to the secure server backend.
   */
  async transformToStudioShot(
    base64Image: string,
    _onRetry?: (attempt: number, delayMs: number) => void
  ): Promise<string> {
    const response = await fetch('/api/gemini/transform-studio-shot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ base64Image }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Error del servidor (${response.status})`);
    }

    const data = await response.json();
    return data.studioImage;
  }

  /**
   * Proxies audio transcription and product detail extraction (title & description) to Gemini.
   */
  async processAudio(
    base64Audio: string,
    mimeType: string = 'audio/webm'
  ): Promise<{ transcription: string; title: string; description: string }> {
    const response = await fetch('/api/gemini/process-audio', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ base64Audio, mimeType }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Error del servidor (${response.status})`);
    }

    return await response.json();
  }
}

export const geminiService = new GeminiService();
