/** Redirect to login on 401. Used by client components that call API routes. */
export function handleApiError(response: Response): void {
  if (response.status === 401) {
    window.location.href = "/";
  }
}

/** Parse snake_case axis label from UMAP API into camelCase state shape. */
export function parseAxisLabel(
  raw: { name: string; direction_low: string; direction_high: string } | null,
): { name: string; directionLow: string; directionHigh: string } | null {
  if (!raw) return null;
  return {
    name: raw.name,
    directionLow: raw.direction_low,
    directionHigh: raw.direction_high,
  };
}
