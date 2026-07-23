import { BondApiError, type ApiResult, type BondClientConfig } from './types';

/**
 * Thin fetch wrapper: attaches the bearer key, serializes query/body, unwraps
 * the `ApiResponse` envelope, and turns any failure into a `BondApiError`.
 */
export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly extraHeaders: Record<string, string>;

  constructor(config: BondClientConfig) {
    if (!config.apiKey) throw new Error('BOND OS SDK: `apiKey` is required.');
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? '').replace(/\/$/, '');
    this.extraHeaders = config.headers ?? {};
    const resolved = config.fetch ?? globalThis.fetch;
    if (!resolved) {
      throw new Error('BOND OS SDK: no global `fetch` found — pass `fetch` in the client config.');
    }
    this.fetchImpl = resolved.bind(globalThis);
  }

  private url(path: string, query?: Record<string, unknown>): string {
    const url = new URL(`${this.baseUrl}${path}`, this.baseUrl || undefined);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: { query?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      accept: 'application/json',
      ...this.extraHeaders,
    };
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path, options.query), {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (error) {
      throw new BondApiError(
        error instanceof Error ? error.message : 'Network request failed.',
        'NETWORK_ERROR',
        0,
      );
    }

    const payload = (await response.json().catch(() => null)) as ApiResult<T> | null;
    if (payload && typeof payload === 'object' && 'success' in payload) {
      if (payload.success) return payload.data;
      throw new BondApiError(payload.error.message, payload.error.code, response.status, payload.error.details);
    }
    if (!response.ok) {
      throw new BondApiError(`Request failed with status ${response.status}.`, 'HTTP_ERROR', response.status);
    }
    // A non-enveloped 2xx (e.g. the OpenAPI document) — return the raw body.
    return payload as unknown as T;
  }

  get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, { body });
  }
}
