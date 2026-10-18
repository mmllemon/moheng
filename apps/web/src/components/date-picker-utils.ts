export function asIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseIsoDate(value?: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function parsedBound(value?: string | number | null): Date | null {
  return value == null || value === '' ? null : parseIsoDate(String(value));
}

export function isIsoDateWithinBounds(value: string, min?: string | number | null, max?: string | number | null): boolean {
  const date = parseIsoDate(value);
  if (!date) return false;
  const minimum = parsedBound(min);
  const maximum = parsedBound(max);
  if (minimum && maximum && minimum.getTime() > maximum.getTime()) return false;
  if (minimum && date.getTime() < minimum.getTime()) return false;
  if (maximum && date.getTime() > maximum.getTime()) return false;
  return true;
}

export function monthIntersectsIsoDateBounds(year: number, monthIndex: number, min?: string | number | null, max?: string | number | null): boolean {
  const minimum = parsedBound(min);
  const maximum = parsedBound(max);
  if (minimum && maximum && minimum.getTime() > maximum.getTime()) return false;
  const monthStart = new Date(year, monthIndex, 1).getTime();
  const monthEnd = new Date(year, monthIndex + 1, 0).getTime();
  return !(maximum && maximum.getTime() < monthStart) && !(minimum && minimum.getTime() > monthEnd);
}

/**
 * Keep calendar focus on an enabled day when a controlled form changes the value
 * or its min/max constraints without remounting the date picker.
 */
export function normalizeIsoDateWithinBounds(value: string, min?: string | number | null, max?: string | number | null): string | null {
  const date = parseIsoDate(value);
  if (!date) return null;
  const minimum = parsedBound(min);
  const maximum = parsedBound(max);
  if (minimum && maximum && minimum.getTime() > maximum.getTime()) return null;
  if (minimum && date.getTime() < minimum.getTime()) return asIsoDate(minimum);
  if (maximum && date.getTime() > maximum.getTime()) return asIsoDate(maximum);
  return asIsoDate(date);
}
