import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

export type BusinessNumberParameter = { defaultValue: number; min: number; max: number };
export type BusinessNumberParameterValues = Map<string, Map<string, number>>;

/**
 * Load published, explicitly business-readable numeric parameters for a bounded project set.
 * Project values override global defaults. Invalid/out-of-range values are ignored and callers
 * retain their safe defaults; admin-only and draft revisions never influence business behaviour.
 */
export async function loadBusinessNumberParameters(
  projectIds: string[],
  definitions: Record<string, BusinessNumberParameter>,
): Promise<BusinessNumberParameterValues> {
  const keys = Object.keys(definitions);
  const result: BusinessNumberParameterValues = new Map();
  if (!keys.length) return result;
  const rows = await prisma.systemParameterRevision.findMany({
    where: {
      key: { in: keys }, status: 'PUBLISHED', visibility: 'BUSINESS_READABLE', valueType: 'NUMBER',
      OR: [{ scope: 'GLOBAL', projectId: null }, ...(projectIds.length ? [{ scope: 'PROJECT', projectId: { in: projectIds } }] : [])] as Prisma.SystemParameterRevisionWhereInput[],
    },
    orderBy: [{ key: 'asc' }, { version: 'desc' }],
    select: { key: true, projectId: true, value: true, version: true },
  });
  for (const row of rows) {
    const definition = definitions[row.key];
    if (!definition || typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < definition.min || row.value > definition.max) continue;
    const scopeKey = row.projectId ?? '*';
    let byScope = result.get(row.key);
    if (!byScope) { byScope = new Map(); result.set(row.key, byScope); }
    // Rows are version-descending, so the first value in each scope is the active revision.
    if (!byScope.has(scopeKey)) byScope.set(scopeKey, row.value);
  }
  return result;
}

export function businessNumberParameter(
  values: BusinessNumberParameterValues,
  key: string,
  projectId: string,
  definition: BusinessNumberParameter,
): number {
  const scoped = values.get(key);
  return scoped?.get(projectId) ?? scoped?.get('*') ?? definition.defaultValue;
}
