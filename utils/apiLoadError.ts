type ApiLoadResult = {
  ok?: boolean;
  message?: string;
  error?: string;
};

export function formatApiLoadError(data: ApiLoadResult): string | null {
  if (data.ok !== false) return null;
  if (data.message) return data.message;
  if (data.error) return data.error;
  return "Could not load from backend.";
}
