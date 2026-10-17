import type { BusinessPartyRole, Prisma } from '../generated/prisma/client.js';

export function normalizeBusinessPartyName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN');
}

export function downstreamPartyRole(type: string): BusinessPartyRole {
  switch (type) {
    case 'MATERIAL_PURCHASE': return 'MATERIAL_SUPPLIER';
    case 'LABOR_SUBCONTRACT': return 'LABOR_SUBCONTRACTOR';
    case 'PROFESSIONAL_SUBCONTRACT': return 'PROFESSIONAL_SUBCONTRACTOR';
    case 'EQUIPMENT_LEASE': return 'EQUIPMENT_LESSOR';
    case 'SERVICE': return 'SERVICE_PROVIDER';
    default: return 'OTHER';
  }
}

type PartyTransaction = Prisma.TransactionClient;

/** Serialize same-name resolution inside the current PostgreSQL transaction. */
export async function lockBusinessPartyName(tx: PartyTransaction, normalizedName: string) {
  // Lightweight mocks in pure unit tests need not implement raw SQL.
  if (typeof tx.$queryRaw === 'function') {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(147384, hashtext(${normalizedName}))`;
  }
}

async function auditPartyMutation(tx: PartyTransaction, input: { actorUserId?: string; auditProjectId?: string | null; partyId: string; action: string; changes: unknown }) {
  if (!input.actorUserId) return;
  await tx.auditLog.create({ data: {
    projectId: input.auditProjectId ?? null, userId: input.actorUserId, entity: 'BusinessParty', entityId: input.partyId,
    action: input.action, changes: input.changes as Prisma.InputJsonValue,
  } });
}

/** Resolve a user-selected party or safely reuse/create a party from a contract counterparty name.
 * Text names on contract records remain as snapshots; this function only establishes the master relation.
 */
export async function resolveBusinessParty(
  tx: PartyTransaction,
  input: { partyId?: string | null; name: string; role: BusinessPartyRole; actorUserId?: string; auditProjectId?: string | null },
) {
  const normalizedName = normalizeBusinessPartyName(input.name);
  if (input.partyId) {
    await lockBusinessPartyName(tx, `id:${input.partyId}`);
    const party = await tx.businessParty.findUnique({ where: { id: input.partyId } });
    if (!party) throw new Error('BUSINESS_PARTY_NOT_FOUND');
    if (party.status !== 'ACTIVE') throw new Error('BUSINESS_PARTY_INACTIVE');
    const roles = [...new Set([...party.roles, input.role])];
    if (roles.length !== party.roles.length) {
      await tx.businessParty.update({ where: { id: party.id }, data: { roles } });
      await auditPartyMutation(tx, { actorUserId: input.actorUserId, auditProjectId: input.auditProjectId, partyId: party.id, action: 'ROLE_ADDED_FROM_BUSINESS_RECORD', changes: { addedRole: input.role, rolesBefore: party.roles, rolesAfter: roles } });
    }
    return { id: party.id, name: party.name };
  }

  await lockBusinessPartyName(tx, normalizedName);
  const matches = await tx.businessParty.findMany({ where: { normalizedName }, orderBy: [{ identityVerified: 'desc' }, { updatedAt: 'desc' }], take: 2 });
  if (matches.length > 1) throw new Error('BUSINESS_PARTY_NAME_AMBIGUOUS');
  const existing = matches[0];
  if (existing) {
    if (existing.status !== 'ACTIVE') throw new Error('BUSINESS_PARTY_INACTIVE');
    const roles = [...new Set([...existing.roles, input.role])];
    if (roles.length !== existing.roles.length) {
      await tx.businessParty.update({ where: { id: existing.id }, data: { roles } });
      await auditPartyMutation(tx, { actorUserId: input.actorUserId, auditProjectId: input.auditProjectId, partyId: existing.id, action: 'ROLE_ADDED_FROM_BUSINESS_RECORD', changes: { addedRole: input.role, rolesBefore: existing.roles, rolesAfter: roles } });
    }
    return { id: existing.id, name: existing.name };
  }

  const created = await tx.businessParty.create({
    data: { name: input.name.trim().replace(/\s+/g, ' '), normalizedName, roles: [input.role] },
    select: { id: true, name: true },
  });
  await auditPartyMutation(tx, { actorUserId: input.actorUserId, auditProjectId: input.auditProjectId, partyId: created.id, action: 'AUTO_CREATE_FROM_BUSINESS_RECORD', changes: { name: created.name, roles: [input.role], normalizedName } });
  return created;
}
