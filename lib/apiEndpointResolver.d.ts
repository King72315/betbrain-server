export const DEFAULT_LOCAL_API_URL: string;
export const DEFAULT_RENDER_API_URL: string;
export const DEFAULT_HEALTH_TIMEOUT_MS: number;

export type ApiBackendId = "LOCAL" | "RENDER";
export type ApiMode = "auto" | "local" | "render";

export type ApiEndpointDiagnostics = {
  activeBackend: ApiBackendId;
  baseUrl: string;
  fallbackUsed: boolean;
  mode: ApiMode;
  localUrl: string;
  renderUrl: string;
  reason?: string;
  error?: string;
};

export function isLocalUrl(url: string): boolean;
export function isRenderUrl(url: string): boolean;

export function getApiEndpointConfig(
  env?: NodeJS.ProcessEnv,
  options?: { isDev?: boolean }
): {
  mode: ApiMode;
  localUrl: string;
  renderUrl: string;
  isDev: boolean;
  legacyApiUrl: string | null;
};

export function probeLocalHealth(
  localUrl: string,
  options?: { fetchFn?: typeof fetch; timeoutMs?: number }
): Promise<{ ok: boolean; reason: string | null }>;

export function selectApiBackend(
  options?: Record<string, unknown>
): Promise<ApiEndpointDiagnostics>;

export function ensureActiveBackend(
  options?: Record<string, unknown>
): Promise<ApiEndpointDiagnostics>;

export function resolveActiveApiBaseUrl(
  options?: Record<string, unknown>
): Promise<string>;

export function getApiEndpointDiagnostics(): ApiEndpointDiagnostics | null;
export function getLockedApiBaseUrlOrNull(): string | null;

export function peekPreferredApiBaseUrl(
  env?: NodeJS.ProcessEnv,
  options?: { isDev?: boolean }
): string;

export function resetApiEndpointSessionForTests(): void;

export function assertSingleBackendTruth(resultMeta?: {
  sources?: string[];
  backends?: string[];
}): boolean;

export function formatBackendBadgeLabel(
  diag: ApiEndpointDiagnostics | null | undefined
): string;
