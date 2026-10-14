import assert from 'node:assert/strict';
import test from 'node:test';
import { downstreamPartyRole, normalizeBusinessPartyName, resolveBusinessParty } from './business-party.js';

test('normalizes party display names for search and exact-name matching', () => {
  assert.equal(normalizeBusinessPartyName('  HUA   DONG 建设有限公司  '), 'hua dong 建设有限公司');
  assert.equal(normalizeBusinessPartyName('材料 供应商'), normalizeBusinessPartyName('材料\t供应商'));
});

test('maps downstream contract types into party roles', () => {
  assert.equal(downstreamPartyRole('MATERIAL_PURCHASE'), 'MATERIAL_SUPPLIER');
  assert.equal(downstreamPartyRole('LABOR_SUBCONTRACT'), 'LABOR_SUBCONTRACTOR');
  assert.equal(downstreamPartyRole('PROFESSIONAL_SUBCONTRACT'), 'PROFESSIONAL_SUBCONTRACTOR');
  assert.equal(downstreamPartyRole('EQUIPMENT_LEASE'), 'EQUIPMENT_LESSOR');
  assert.equal(downstreamPartyRole('SERVICE'), 'SERVICE_PROVIDER');
  assert.equal(downstreamPartyRole('OTHER'), 'OTHER');
});

test('reuses a unique exact-name party and adds the requested role', async () => {
  const party = { id: 'party-1', name: '华东建设有限公司', normalizedName: '华东建设有限公司', roles: ['OTHER'], status: 'ACTIVE' };
  let updatedRoles: string[] | undefined;
  const tx = {
    businessParty: {
      findMany: async () => [party],
      update: async (args: { data: { roles: string[] } }) => { updatedRoles = args.data.roles; return { ...party, roles: updatedRoles }; },
    },
  } as never;
  const result = await resolveBusinessParty(tx, { name: ' 华东建设有限公司 ', role: 'OWNER' });
  assert.deepEqual(result, { id: 'party-1', name: '华东建设有限公司' });
  assert.deepEqual(updatedRoles, ['OTHER', 'OWNER']);
});

test('refuses ambiguous unqualified names so contracts must choose the intended master record', async () => {
  const tx = {
    businessParty: {
      findMany: async () => [
        { id: 'party-1', name: '同名供应商', roles: ['MATERIAL_SUPPLIER'], status: 'ACTIVE' },
        { id: 'party-2', name: '同名供应商', roles: ['MATERIAL_SUPPLIER'], status: 'ACTIVE' },
      ],
    },
  } as never;
  await assert.rejects(
    resolveBusinessParty(tx, { name: '同名供应商', role: 'MATERIAL_SUPPLIER' }),
    (error: unknown) => error instanceof Error && error.message === 'BUSINESS_PARTY_NAME_AMBIGUOUS',
  );
});

test('creates a provisional party when no exact-name master record exists', async () => {
  let createdInput: unknown;
  const tx = {
    businessParty: {
      findMany: async () => [],
      create: async (args: { data: { name: string; normalizedName: string; roles: string[] } }) => {
        createdInput = args.data;
        return { id: 'party-new', name: args.data.name };
      },
    },
  } as never;
  const result = await resolveBusinessParty(tx, { name: ' 新供应商有限公司 ', role: 'MATERIAL_SUPPLIER' });
  assert.deepEqual(result, { id: 'party-new', name: '新供应商有限公司' });
  assert.deepEqual(createdInput, { name: '新供应商有限公司', normalizedName: '新供应商有限公司', roles: ['MATERIAL_SUPPLIER'] });
});

test('selected ID wins over text and cannot silently attach to a nonexistent party', async () => {
  const tx = { businessParty: { findUnique: async () => null } } as never;
  await assert.rejects(
    resolveBusinessParty(tx, { partyId: 'missing-party', name: '任意名称', role: 'OWNER' }),
    (error: unknown) => error instanceof Error && error.message === 'BUSINESS_PARTY_NOT_FOUND',
  );
});


test('serializes automatic create and writes a master-data audit record', async () => {
  let lockCalled = false;
  const auditRows: Array<{ data: { entity: string; entityId: string; action: string; projectId: string | null } }> = [];
  const tx = {
    $queryRaw: async () => { lockCalled = true; },
    businessParty: {
      findMany: async () => [],
      create: async (args: { data: { name: string; normalizedName: string; roles: string[] } }) => ({ id: 'party-audited', name: args.data.name }),
    },
    auditLog: { create: async (args: typeof auditRows[number]) => { auditRows.push(args); return args; } },
  } as never;
  await resolveBusinessParty(tx, { name: '新建后即关联合同的单位', role: 'OWNER', actorUserId: 'user-1', auditProjectId: 'project-1' });
  assert.equal(lockCalled, true);
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].data.entity, 'BusinessParty');
  assert.equal(auditRows[0].data.entityId, 'party-audited');
  assert.equal(auditRows[0].data.action, 'AUTO_CREATE_FROM_BUSINESS_RECORD');
  assert.equal(auditRows[0].data.projectId, 'project-1');
});
