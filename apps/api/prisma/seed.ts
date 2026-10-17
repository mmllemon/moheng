import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@local.test').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  if (process.env.NODE_ENV === 'production' && password === 'ChangeMe123!') {
    throw new Error('生产环境禁止使用默认 SEED_ADMIN_PASSWORD，请设置强密码。');
  }
  let admin = await prisma.user.findUnique({ where: { email } });
  if (!admin) {
    const passwordHash = await bcrypt.hash(password, 12);
    admin = await prisma.user.create({
      data: { name: process.env.SEED_ADMIN_NAME ?? '系统管理员', email, passwordHash, role: 'ADMIN', passwordResetRequired: process.env.NODE_ENV === 'production' },
    });
    console.log(`Created seed administrator: ${email}`);
  } else if (admin.role !== 'ADMIN') {
    throw new Error(`Configured seed email ${email} already exists but is not ADMIN. Resolve the account explicitly before startup.`);
  } else {
    console.log(`Seed administrator already exists; preserving its password and account status: ${email}`);
  }

  if (process.env.SEED_DEMO_DATA === 'false') return;

  const project = await prisma.project.upsert({
    where: { code: 'DEMO-001' },
    create: {
      name: '滨江综合服务中心项目', code: 'DEMO-001', type: 'HOUSING', ownerName: '滨江城市建设发展有限公司',
      contractAmount: '12580000.00', originalContractAmount: '12580000.00', startDate: new Date('2026-01-15T00:00:00.000Z'), plannedEndDate: new Date('2027-06-30T00:00:00.000Z'),
      status: 'CONSTRUCTION', address: '示例地址', managerName: '王工',
    },
    update: {},
  });
  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: project.id, userId: admin.id } },
    create: { projectId: project.id, userId: admin.id, role: 'OWNER' },
    update: {},
  });
  await prisma.mainContract.upsert({
    where: { projectId: project.id },
    create: { projectId: project.id, contractNo: 'HT-DEMO-001', name: '滨江综合服务中心施工总承包合同', signedAt: new Date('2025-12-20T00:00:00.000Z'), amount: '12580000.00', taxIncluded: true, retentionRate: '0.03', paymentTerms: '按月申报进度款，最终以合同专用条款为准。' },
    update: {},
  });
  const rows = [
    { code: '01', name: '土建工程', unit: null, quantity: null, unitPrice: null, totalPrice: 0, level: 1, sortOrder: 1 },
    { code: '0101', name: '基础工程', unit: null, quantity: null, unitPrice: null, totalPrice: 0, level: 2, sortOrder: 1, parentCode: '01' },
    { code: '010101', name: '钢筋混凝土独立基础', unit: 'm³', quantity: 320, unitPrice: 1200, totalPrice: 384000, level: 3, sortOrder: 1, parentCode: '0101' },
    { code: '010102', name: '基础垫层', unit: 'm³', quantity: 110, unitPrice: 480, totalPrice: 52800, level: 3, sortOrder: 2, parentCode: '0101' },
    { code: '02', name: '机电安装', unit: null, quantity: null, unitPrice: null, totalPrice: 0, level: 1, sortOrder: 2 },
    { code: '020101', name: '电气安装工程', unit: '项', quantity: 1, unitPrice: 680000, totalPrice: 680000, level: 2, sortOrder: 1, parentCode: '02' },
  ] as const;
  const existingCount = await prisma.budgetItem.count({ where: { projectId: project.id } });
  if (existingCount === 0) {
    const ids = new Map<string, string>();
    for (const row of rows) {
      const parentId = 'parentCode' in row ? ids.get(row.parentCode) ?? null : null;
      const item = await prisma.budgetItem.create({ data: {
        projectId: project.id, code: row.code, name: row.name, unit: row.unit,
        quantity: row.quantity === null ? null : String(row.quantity), unitPrice: row.unitPrice === null ? null : String(row.unitPrice),
        totalPrice: String(row.totalPrice), level: row.level, sortOrder: row.sortOrder, parentId,
      } });
      ids.set(row.code, item.id);
    }
    const firstLeaf = ids.get('010101');
    if (firstLeaf) await prisma.costEntry.create({ data: { projectId: project.id, type: 'MATERIAL', date: new Date(), amount: '58000.00', budgetItemId: firstLeaf, description: '示例钢筋材料采购', quantity: '12.5', unit: 't', unitPrice: '4640', vendorName: '示例材料供应商', createdById: admin.id } });
    const secondLeaf = ids.get('010102');
    if (secondLeaf) await prisma.costEntry.create({ data: { projectId: project.id, type: 'LABOR', date: new Date(), amount: '16800.00', budgetItemId: secondLeaf, description: '示例基础施工人工费', quantity: '14', unit: '工日', unitPrice: '1200', teamName: '基础施工班组', createdById: admin.id } });
    await prisma.progressBill.create({ data: { projectId: project.id, periodNo: 1, applyDate: new Date(), measureDate: new Date(), amount: '580000.00', status: 'UNDER_REVIEW', notes: '示例数据，可编辑或删除后重新录入。' } });
    await prisma.change.create({ data: { projectId: project.id, code: 'BG-001', name: '地下室局部优化', type: 'ENGINEERING_CHANGE', direction: 'INCREASE', occurredAt: new Date(), submittedAmount: '38000.00', status: 'SUBMITTED', createdById: admin.id, submittedById: admin.id, description: '示例变更记录。' } });
    console.log('Seeded demo project, budget, costs, progress bill, and change records.');
  }
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
