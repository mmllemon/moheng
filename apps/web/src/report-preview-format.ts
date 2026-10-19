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
