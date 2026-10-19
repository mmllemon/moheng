/**
 * Round a decimal string to a fixed number of fractional digits without using
 * binary floating point. Rounding is half away from zero, matching the visual
 * number format used by report preview cells.
 */
export function roundFixedDecimal(raw: string, decimals: number): string | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 80) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw.trim());
  if (!match) return null;

  const fraction = match[3] ?? '';
  const scale = 10n ** BigInt(decimals);
  const retainedFraction = fraction.slice(0, decimals).padEnd(decimals, '0');
  let scaled = BigInt(match[2]!) * scale + BigInt(retainedFraction || '0');
  if ((fraction[decimals] ?? '0') >= '5') scaled += 1n;

  const whole = (scaled / scale).toString();
  const fractional = decimals > 0 ? (scaled % scale).toString().padStart(decimals, '0') : '';
  return `${match[1]}${whole}${decimals > 0 ? `.${fractional}` : ''}`;
}


/**
 * Format an ISO date using the numeric year/month/day tokens supported by
 * common Excel number formats. Return null for locale-dependent month/day
 * names or time tokens so callers can use a predictable fallback.
 */
export function formatIsoDateWithExcelPattern(value: string, pattern: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  const section = pattern.split(';', 1)[0]!.replace(/\[[^\]]*\]/g, '');
  const tokenPattern = /"(?:""|[^"])*"|\\.|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s/gi;
  for (const item of section.matchAll(tokenPattern)) {
    const token = item[0]!;
    if (token.startsWith('"') || token.startsWith('\\')) continue;
    if (/^(?:mmmm|mmm|dddd|ddd|hh|h|ss|s)$/i.test(token)) return null;
  }
  if (!/(?:y{2,4}|m{1,2}|d{1,2})/i.test(section)) return null;

  return section.replace(tokenPattern, (token) => {
    if (token.startsWith('"')) return token.slice(1, -1).replaceAll('""', '"');
    if (token.startsWith('\\')) return token.slice(1);
    switch (token.toLowerCase()) {
      case 'yyyy': return String(year).padStart(4, '0');
      case 'yy': return String(year % 100).padStart(2, '0');
      case 'm': return String(month);
      case 'mm': return String(month).padStart(2, '0');
      case 'd': return String(day);
      case 'dd': return String(day).padStart(2, '0');
      default: return token;
    }
  });
}
