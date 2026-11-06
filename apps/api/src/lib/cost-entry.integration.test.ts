/**
 * 实际成本写入、合同关联修正与归档的路由级回归（真实 PostgreSQL）。
 *
 * 成本台账是经营数据的地基：一条记录会同时决定三算对比的实际成本、分供合同的
 * 已发生额归属、以及往来单位维度的口径。它也是唯一允许「事后把历史成本改挂到另一份
 * 合同」的地方，而新建时又禁止挂草稿合同——两条规则方向相反，容易改错。
 *
 * 覆盖：含税口径反算与不一致拒绝、跨项目预算项/合同拒绝、草稿合同不能新增成本、
 * 关联合同时相对方不一致拒绝且自动落 vendorName、关联修正审计、归档软删与权限。
 *
 * 运行（隔离库，必须先跑迁移）：
 *   COST_ENTRY_TESTS=true DATABASE_URL=postgresql://.../isolated_test npm run test:cost-entry:postgres -w @cms/api
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from './prisma.js';
import { costRoutes } from '../routes/costs.js';
import { normalizeBusinessPartyName } from './business-party.js';

const enabled = process.env.COST_ENTRY_TESTS === 'true';
const TEST_SECRET = 'test-only-jwt-secret-that-is-not-a-credential-32';

test('成本台账：含税口径、跨项目关联拒绝、草稿合同拒挂、关联修正审计、归档软删与权限', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const app = Fastify();
  await app.register(jwt, { secret: TEST_SECRET });
  await app.register(costRoutes, { prefix: '/api/projects' });
  await app.ready();

  const userIds: string[] = [];
  let projectId: string | undefined;
  let otherProjectId: string | undefined;

  async function makeActor(label: string, role: 'ADMIN' | 'USER' = 'ADMIN') {
    const user = await prisma.user.create({ data: {
      name: `Cost Fixture ${label} ${suffix}`,
      email: `cost-fixture-${label}-${suffix}@example.invalid`,
      passwordHash: 'test-only-not-a-login-password',
      role,
    } });
    userIds.push(user.id);
    const session = await prisma.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, sid: session.id });
    return { userId: user.id, headers: { authorization: `Bearer ${token}` } };
  }

  const call = async (actor: { headers: Record<string, string> }, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) => {
    const response = await app.inject({ method, url, headers: actor.headers, ...(payload === undefined ? {} : { payload }) });
    const text = response.body ?? '';
    let body: any = null;
    if (text) { try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; } }
    return { status: response.statusCode, body };
  };
  const toCents = (value: unknown) => BigInt(Math.round(Number(value ?? 0) * 100));

  try {
    const admin = await makeActor('admin');
    const estimatorUser = await makeActor('estimator', 'USER');
    const ownerUser = await makeActor('owner', 'USER');

    const project = await prisma.project.create({ data: {
      name: `Cost Entry ${suffix}`,
      code: `CE-${suffix}`,
      ownerName: 'Gate Owner',
      contractAmount: '3000000.00',
      originalContractAmount: '3000000.00',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    } });
    projectId = project.id;
    const otherProject = await prisma.project.create({ data: {
      name: `Cost Entry Other ${suffix}`,
      code: `CEO-${suffix}`,
      ownerName: 'Gate Owner',
      contractAmount: '100000.00',
      originalContractAmount: '100000.00',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    } });
    otherProjectId = otherProject.id;

    await prisma.projectMember.createMany({ data: [
      { projectId: project.id, userId: estimatorUser.userId, role: 'ESTIMATOR' },
      { projectId: project.id, userId: ownerUser.userId, role: 'OWNER' },
    ] });

    const partyA = await prisma.businessParty.create({ data: {
      name: `成本单位甲 ${suffix}`, normalizedName: normalizeBusinessPartyName(`成本单位甲 ${suffix}`), roles: ['MATERIAL_SUPPLIER'], identityVerified: true,
    } });
    const partyB = await prisma.businessParty.create({ data: {
      name: `成本单位乙 ${suffix}`, normalizedName: normalizeBusinessPartyName(`成本单位乙 ${suffix}`), roles: ['MATERIAL_SUPPLIER'], identityVerified: true,
    } });

    const budgetItem = await prisma.budgetItem.create({ data: {
      projectId: project.id, code: `BI-${suffix}`, name: '地下室钢筋', totalPrice: '1000000.00',
    } });
    const foreignBudgetItem = await prisma.budgetItem.create({ data: {
      projectId: otherProject.id, code: `BIO-${suffix}`, name: '别的项目清单', totalPrice: '1000.00',
    } });

    const activeContract = await prisma.downstreamContract.create({ data: {
      projectId: project.id, contractNo: `DC-A-${suffix}`, name: '钢筋采购', type: 'MATERIAL_PURCHASE',
      counterpartyName: partyA.name, counterpartyPartyId: partyA.id, originalAmount: '800000.00',
      status: 'ACTIVE', signedAt: new Date('2026-01-05T00:00:00.000Z'), createdById: admin.userId,
    } });
    const draftContract = await prisma.downstreamContract.create({ data: {
      projectId: project.id, contractNo: `DC-B-${suffix}`, name: '草稿合同', type: 'MATERIAL_PURCHASE',
      counterpartyName: partyB.name, counterpartyPartyId: partyB.id, originalAmount: '50000.00',
      status: 'DRAFT', signedAt: new Date('2026-01-05T00:00:00.000Z'), createdById: admin.userId,
    } });
    const otherActiveContract = await prisma.downstreamContract.create({ data: {
      projectId: project.id, contractNo: `DC-C-${suffix}`, name: '混凝土采购', type: 'MATERIAL_PURCHASE',
      counterpartyName: partyB.name, counterpartyPartyId: partyB.id, originalAmount: '200000.00',
      status: 'ACTIVE', signedAt: new Date('2026-01-05T00:00:00.000Z'), createdById: admin.userId,
    } });

    const base = `/api/projects/${project.id}/costs`;
    const createCost = (actor: typeof admin, overrides: Record<string, unknown> = {}) => call(actor, 'POST', base, {
      type: 'MATERIAL', date: '2026-03-01T00:00:00.000Z', amount: 1130, description: '地下室钢筋进场', ...overrides,
    });

    // —— 1. 含税口径：给税率时反算税额 ——
    const autoTax = await createCost(admin, { taxRate: 13 });
    assert.equal(autoTax.status, 201, `录入应成功：${JSON.stringify(autoTax.body).slice(0, 200)}`);
    assert.equal(toCents(autoTax.body.data.amount), 113000n);
    assert.equal(toCents(autoTax.body.data.taxAmount), 13000n, '1130 含税、13% 时应反算出 130 税额');
    const entryId = autoTax.body.data.id as string;
    assert.ok(await prisma.auditLog.findFirst({ where: { projectId: project.id, entity: 'CostEntry', entityId: entryId, action: 'CREATE' } }), '录入应写 CREATE 审计');

    // —— 2. 税额与税率不一致时拒绝 ——
    const inconsistent = await createCost(admin, { taxRate: 13, taxAmount: 200 });
    assert.equal(inconsistent.status, 400);
    assert.equal(inconsistent.body.error.code, 'COST_TAX_INCONSISTENT');

    // —— 3. 金额必须为正 ——
    const zero = await createCost(admin, { amount: 0 });
    assert.equal(zero.status, 400);
    assert.equal(zero.body.error.code, 'VALIDATION_ERROR');

    // —— 4. 跨项目预算项不能关联 ——
    const foreignBudget = await createCost(admin, { budgetItemId: foreignBudgetItem.id });
    assert.equal(foreignBudget.status, 400);
    assert.equal(foreignBudget.body.error.code, 'BUDGET_ITEM_INVALID');

    // —— 5. 新建时不能挂草稿合同 ——
    const draftLink = await createCost(admin, { downstreamContractId: draftContract.id });
    assert.equal(draftLink.status, 409);
    assert.equal(draftLink.body.error.code, 'DOWNSTREAM_CONTRACT_NOT_ACTIVE');

    // —— 6. 关联合同时，所选往来单位必须是合同相对方 ——
    const mismatch = await createCost(admin, { downstreamContractId: activeContract.id, businessPartyId: partyB.id });
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.error.code, 'COST_PARTY_CONTRACT_MISMATCH');

    // —— 7. 挂上合同后，vendorName 自动取合同相对方名称 ——
    const linked = await createCost(admin, { downstreamContractId: activeContract.id, budgetItemId: budgetItem.id });
    assert.equal(linked.status, 201, `关联录入应成功：${JSON.stringify(linked.body).slice(0, 200)}`);
    const linkedRow = await prisma.costEntry.findUniqueOrThrow({ where: { id: linked.body.data.id as string } });
    assert.equal(linkedRow.vendorName, partyA.name, '关联合同时供应商名应取合同相对方');
    assert.equal(linkedRow.businessPartyId, partyA.id);

    // —— 8. 历史成本改挂到另一份生效合同：金额不变，审计留痕 ——
    const relink = await call(admin, 'PATCH', `${base}/${linkedRow.id}/link-contract`, { downstreamContractId: otherActiveContract.id });
    assert.equal(relink.status, 200, `关联修正应成功：${JSON.stringify(relink.body).slice(0, 200)}`);
    const afterRelink = await prisma.costEntry.findUniqueOrThrow({ where: { id: linkedRow.id } });
    assert.equal(afterRelink.downstreamContractId, otherActiveContract.id);
    assert.equal(afterRelink.businessPartyId, partyB.id, '改挂后相对方应跟着换');
    assert.equal(toCents(afterRelink.amount), toCents(linkedRow.amount), '关联修正不得改金额');
    const relinkAudit = await prisma.auditLog.findFirst({ where: { entity: 'CostEntry', entityId: linkedRow.id, action: 'LINK_DOWNSTREAM_CONTRACT' } });
    const relinkChanges = relinkAudit?.changes as Record<string, unknown> | undefined;
    assert.equal(relinkChanges?.fromDownstreamContractId, activeContract.id);
    assert.equal(relinkChanges?.toDownstreamContractId, otherActiveContract.id);
    assert.equal(relinkChanges?.amountUnchanged, true);

    // —— 9. 但关联修正也不能指向草稿合同 ——
    const relinkDraft = await call(admin, 'PATCH', `${base}/${linkedRow.id}/link-contract`, { downstreamContractId: draftContract.id });
    assert.equal(relinkDraft.status, 409);
    assert.equal(relinkDraft.body.error.code, 'DOWNSTREAM_CONTRACT_NOT_ACTIVE');

    // —— 10. 归档：软删 + 审计 + 列表不可见 + 重复归档 404 ——
    const archived = await call(ownerUser, 'POST', `${base}/${entryId}/archive`);
    assert.equal(archived.status, 200, `归档应成功：${JSON.stringify(archived.body).slice(0, 160)}`);
    const archivedRow = await prisma.costEntry.findUniqueOrThrow({ where: { id: entryId } });
    assert.ok(archivedRow.deletedAt, '归档应写 deletedAt');
    assert.ok(await prisma.auditLog.findFirst({ where: { entity: 'CostEntry', entityId: entryId, action: 'ARCHIVE' } }), '归档应写审计');
    const listed = await call(admin, 'GET', base);
    assert.equal(listed.status, 200, `列表应返回 200，实际 ${listed.status}：${JSON.stringify(listed.body).slice(0, 160)}`);
    assert.ok(!((listed.body.data ?? []) as { id: string }[]).some((row) => row.id === entryId), '归档后列表不应再出现');
    const rearchive = await call(ownerUser, 'POST', `${base}/${entryId}/archive`);
    assert.equal(rearchive.status, 404, `重复归档应为 404，实际 ${rearchive.status}，body=${JSON.stringify(rearchive.body).slice(0, 160)}`);
    assert.equal(rearchive.body?.error?.code ?? rearchive.body?.code, 'COST_NOT_FOUND');

    // —— 11. 权限：项目编制人可以录入，但不能归档 ——
    const createdByEstimator = await createCost(estimatorUser);
    assert.equal(createdByEstimator.status, 201, '编制人应能录入成本');
    const estimatorArchive = await call(estimatorUser, 'POST', `${base}/${createdByEstimator.body.data.id as string}/archive`);
    assert.equal(estimatorArchive.status, 403, `归档需要 ACTUAL_COST_ADMIN 权限，实际 ${estimatorArchive.status}`);
    assert.equal(estimatorArchive.body?.error?.code, 'PROJECT_PERMISSION_DENIED', `权限拒绝应带错误码，实际 body=${JSON.stringify(estimatorArchive.body).slice(0, 160)}`);
  } finally {
    await app.close();
    try {
      if (projectId) {
        await prisma.costEntry.deleteMany({ where: { projectId } });
        await prisma.auditLog.deleteMany({ where: { projectId } });
        await prisma.projectMember.deleteMany({ where: { projectId } });
        await prisma.downstreamContract.deleteMany({ where: { projectId } });
        await prisma.budgetItem.deleteMany({ where: { projectId } });
        await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
      }
      if (otherProjectId) {
        await prisma.budgetItem.deleteMany({ where: { projectId: otherProjectId } }).catch(() => undefined);
        await prisma.project.deleteMany({ where: { id: otherProjectId } }).catch(() => undefined);
      }
      await prisma.businessParty.deleteMany({ where: { name: { contains: `成本单位` } } }).catch(() => undefined);
      for (const userId of userIds) {
        await prisma.authSession.deleteMany({ where: { userId } }).catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
      }
    } catch (error) {
      console.warn('清理测试数据失败：', error instanceof Error ? error.message.slice(0, 160) : error);
    }
    await prisma.$disconnect();
  }
});
