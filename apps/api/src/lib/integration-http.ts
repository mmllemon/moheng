import { isIP } from 'node:net';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { lookup } from 'node:dns/promises';

export type IntegrationHttpResult = { statusCode: number; durationMs: number; responseExcerpt: string };
export class IntegrationHttpError extends Error {
  readonly retryable: boolean;
  readonly code: string;
  constructor(code: string, retryable: boolean) { super(code); this.name = 'IntegrationHttpError'; this.code = code; this.retryable = retryable; }
}

function ipv4IsPublic(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}
function ipv6IsPublic(address: string): boolean {
  const value = address.toLowerCase().split('%')[0]!;
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice(7);
    if (isIP(mapped) === 4) return ipv4IsPublic(mapped);
    return false;
  }
  // Permit only global-unicast 2000::/3 and reject documentation/reserved ranges.
  if (!value.startsWith('2') && !value.startsWith('3')) return false;
  if (value.startsWith('2001:0:') || value.startsWith('2001:2:') || value.startsWith('2001:3:') || value.startsWith('2001:10:') || value.startsWith('2001:20:') || value.startsWith('2001:db8:') || value.startsWith('2002:') || value.startsWith('3fff:')) return false;
  return true;
}
function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return ipv4IsPublic(address);
  if (kind === 6) return ipv6IsPublic(address);
  return false;
}

function isHostAllowed(host: string, setting = process.env.INTEGRATION_ALLOWED_HOSTS ?? ''): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, '');
  const entries = setting.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (!entries.length) return false;
  return entries.some((entry) => {
    if (entry.startsWith('*.')) return normalized.endsWith(entry.slice(1)) && normalized !== entry.slice(2);
    return normalized === entry;
  });
}

async function resolvePublicEndpoint(rawUrl: string): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new IntegrationHttpError('INTEGRATION_URL_INVALID', false); }
  const literalHost = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || isIP(literalHost)) throw new IntegrationHttpError('INTEGRATION_URL_UNSAFE', false);
  const host = literalHost.toLowerCase().replace(/\.$/, '');
  if (!host || ['localhost', 'metadata.google.internal', 'instance-data.ec2.internal'].includes(host) || host.endsWith('.localhost') || host.endsWith('.local')) throw new IntegrationHttpError('INTEGRATION_HOST_UNSAFE', false);
  if (!isHostAllowed(host)) throw new IntegrationHttpError('INTEGRATION_HOST_NOT_ALLOWLISTED', false);
  let addresses: Array<{ address: string; family: number }>;
  try { addresses = await lookup(host, { all: true, verbatim: true }); }
  catch { throw new IntegrationHttpError('INTEGRATION_DNS_FAILED', true); }
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) throw new IntegrationHttpError('INTEGRATION_DNS_RESOLVES_PRIVATE_ADDRESS', false);
  const first = addresses[0]!;
  if (first.family !== 4 && first.family !== 6) throw new IntegrationHttpError('INTEGRATION_DNS_INVALID', false);
  return { url, address: first.address, family: first.family as 4 | 6 };
}

export async function requestIntegrationEndpoint(input: {
  endpointUrl: string;
  method: 'HEAD' | 'POST';
  bearerSecret?: string;
  payload?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
}): Promise<IntegrationHttpResult> {
  const { url, address, family } = await resolvePublicEndpoint(input.endpointUrl);
  const body = input.method === 'POST' ? Buffer.from(JSON.stringify(input.payload ?? {}), 'utf8') : undefined;
  if (body && body.length > 256 * 1024) throw new IntegrationHttpError('INTEGRATION_PAYLOAD_TOO_LARGE', false);
  const started = Date.now();
  const options: RequestOptions = {
    protocol: 'https:', hostname: url.hostname, port: url.port || 443, path: `${url.pathname}${url.search}`,
    method: input.method, servername: url.hostname, timeout: input.timeoutMs ?? 10_000,
    headers: {
      accept: 'application/json, text/plain;q=0.5',
      ...(input.bearerSecret ? { authorization: `Bearer ${input.bearerSecret}` } : {}),
      ...(input.idempotencyKey ? { 'idempotency-key': input.idempotencyKey } : {}),
      ...(body ? { 'content-type': 'application/json', 'content-length': String(body.length) } : {}),
      'user-agent': 'MoHeng-Integration/2.14',
    },
    // Pin the request to the checked public DNS answer to limit rebinding/TOCTOU risk.
    lookup: ((_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => callback(null, address, family)) as RequestOptions['lookup'],
  };
  return new Promise<IntegrationHttpResult>((resolve, reject) => {
    const request = httpsRequest(options, (response) => {
      let excerpt = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { if (excerpt.length < 4096) excerpt += chunk.slice(0, 4096 - excerpt.length); });
      response.on('error', () => reject(new IntegrationHttpError('INTEGRATION_RESPONSE_READ_FAILED', true)));
      response.on('end', () => {
        const statusCode = response.statusCode ?? 0;
        const ok = statusCode >= 200 && statusCode < 300;
        if (!ok) return reject(new IntegrationHttpError(`INTEGRATION_HTTP_${statusCode || 'NO_STATUS'}`, statusCode === 429 || statusCode >= 500 || statusCode === 0));
        resolve({ statusCode, durationMs: Date.now() - started, responseExcerpt: excerpt.replace(/\s+/g, ' ').slice(0, 500) });
      });
    });
    request.once('timeout', () => { request.destroy(new Error('timeout')); });
    request.once('error', () => reject(new IntegrationHttpError('INTEGRATION_NETWORK_ERROR', true)));
    if (body) request.write(body);
    request.end();
  });
}
