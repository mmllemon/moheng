/**
 * 演示数据：完整业务链路。
 *
 * 目标不是把库填满，而是让每一条业务链至少走一遍真实规则，用来验证接口、状态机、
 * 派生字段和页面在"有数据"时是否成立。所有流程数据都通过 HTTP 接口写入，规则由
 * 服务端自己判定；脚本只提供输入并断言输出。
 *
 * 覆盖链路：
 *   项目 → 主合同 → 目标成本清单 → 变更签证（含外部确认生效）→ 进度款审批与到账
 *   → 业主预付款 → 业主最终结算过账（生成应收、留存与预付款扣回）→ 应收到账
 *   → 分供合同（含补充协议、付款计划、预付款）→ 阶段结算过账 → 应付与付款核销
 *   → 完工合同最终结算 → 供应商发票与勾稽 → 实际成本归集到清单项
 *
 * 用法：先启动 API（npm run dev 或 npm run dev -w @cms/api），再执行
 *   npx tsx prisma/seed-demo-chain.ts        （或 npm run seed:demo-chain -w @cms/api）
 *
 * 幂等：每次运行会先清空本项目编号下的全部数据（含凭证文件目录）再重建。
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prisma } from '../src/lib/prisma.js';

const API = (process.env.API_BASE ?? 'http://127.0.0.1:3001/api').replace(/\/$/, '');
const ADMIN = {
  email: (process.env.SEED_ADMIN_EMAIL ?? 'admin@local.test').toLowerCase(),
  password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!',
};
const REVIEWER = { name: '商务经理（演示）', email: 'reviewer@local.test', password: 'ReviewerDemo2026!' };
const PROJECT = {
  code: 'DEMO-CHAIN-01',
  name: '锦澜花园二期住宅项目',
  ownerName: '锦澜置业发展有限公司',
  contractAmount: 32_000_000,
  startDate: '2026-03-01T00:00:00.000Z',
  plannedEndDate: '2027-09-30T00:00:00.000Z',
  managerName: '陈工',
  address: '演示市锦澜路 88 号',
};

const iso = (date: string) => new Date(date).toISOString();
const money = (value: number) => value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const steps: string[] = [];
const step = (message: string) => { steps.push(message); console.log(`  ✓ ${message}`); };

class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly body: unknown) {
    super(`${status} ${code}: ${message}`);
  }
}

async function loginOnce(email: string, password: string): Promise<{ accessToken?: string; flow?: string; restrictedToken?: string }> {
  const response = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const body = await response.json().catch(() => null) as any;
  if (!response.ok) throw new Error(`登录失败（${email}）：${response.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body?.data ?? {};
}

/** 新建账号带 passwordResetRequired，登录会返回改密挑战；这里把它走完再取正式令牌。 */
async function login(email: string, password: string): Promise<string> {
  const first = await loginOnce(email, password);
  if (first.accessToken) return first.accessToken;
  if (first.flow === 'password-change' && first.restrictedToken) {
    const response = await fetch(`${API}/auth/password/change`, {
      method: 'POST',
      headers: { authorization: `Bearer ${first.restrictedToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) throw new Error(`首次改密失败（${email}）：${response.status} ${JSON.stringify(body).slice(0, 200)}`);
    const second = await loginOnce(email, password);
    if (second.accessToken) return second.accessToken;
  }
  throw new Error(`登录未取得令牌（${email}）：${JSON.stringify(first).slice(0, 200)}`);
}

function client(token: string) {
  return async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as any;
    if (!response.ok || payload?.success === false) {
      const code = payload?.error?.code ?? 'HTTP_ERROR';
      const message = payload?.error?.message ?? response.statusText;
      throw new ApiError(response.status, code, message, payload?.error?.details ?? null);
    }
    return (payload?.data ?? payload) as T;
  };
}

/* ---------------- 清理 ---------------- */

async function cleanup() {
  const project = await prisma.project.findUnique({ where: { code: PROJECT.code }, select: { id: true } });
  if (!project) return;
  const projectId = project.id;
  const contracts = await prisma.downstreamContract.findMany({ where: { projectId }, select: { id: true } });
  const contractIds = contracts.map((row) => row.id);
  const settlements = await prisma.downstreamContractSettlement.findMany({ where: { downstreamContractId: { in: contractIds } }, select: { id: true } });
  const settlementIds = settlements.map((row) => row.id);
  const payables = await prisma.downstreamPayable.findMany({ where: { downstreamContractId: { in: contractIds } }, select: { id: true } });
  const payableIds = payables.map((row) => row.id);
  const payments = await prisma.downstreamContractPayment.findMany({ where: { downstreamContractId: { in: contractIds } }, select: { id: true } });
  const paymentIds = payments.map((row) => row.id);
  const invoices = await prisma.downstreamSupplierInvoice.findMany({ where: { downstreamContractId: { in: contractIds } }, select: { id: true } });
  const invoiceIds = invoices.map((row) => row.id);
  const ownerSettlements = await prisma.ownerContractSettlement.findMany({ where: { projectId }, select: { id: true } });
  const ownerSettlementIds = ownerSettlements.map((row) => row.id);
  const receivables = await prisma.ownerReceivable.findMany({ where: { projectId }, select: { id: true } });
  const receivableIds = receivables.map((row) => row.id);
  const receipts = await prisma.ownerReceipt.findMany({ where: { projectId }, select: { id: true } });
  const receiptIds = receipts.map((row) => row.id);

  await prisma.downstreamInvoiceAllocation.deleteMany({ where: { OR: [{ invoiceId: { in: invoiceIds } }, { payableId: { in: payableIds } }] } });
  await prisma.downstreamPaymentAllocation.deleteMany({ where: { OR: [{ paymentId: { in: paymentIds } }, { payableId: { in: payableIds } }] } });
  await prisma.downstreamPayableSchedule.deleteMany({ where: { payableId: { in: payableIds } } });
  await prisma.downstreamPayable.deleteMany({ where: { id: { in: payableIds } } });
  await prisma.downstreamSupplierInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
  await prisma.downstreamContractPayment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.downstreamSettlementPosting.deleteMany({ where: { settlementId: { in: settlementIds } } });
  await prisma.downstreamSettlementLine.deleteMany({ where: { settlementId: { in: settlementIds } } });
  // 质保金流水引用结算单，必须先于结算单删除。
  await prisma.downstreamRetentionMovement.deleteMany({ where: { downstreamContractId: { in: contractIds } } });
  await prisma.downstreamContractSettlement.deleteMany({ where: { id: { in: settlementIds } } });
  await prisma.downstreamContractAdjustment.deleteMany({ where: { downstreamContractId: { in: contractIds } } });
  await prisma.downstreamPaymentPlan.deleteMany({ where: { downstreamContractId: { in: contractIds } } });
  // 成本记录同时引用分供合同与清单项，必须比两者都先删。
  await prisma.costEntry.deleteMany({ where: { projectId } });
  await prisma.downstreamContract.deleteMany({ where: { id: { in: contractIds } } });

  await prisma.ownerReceiptAllocation.deleteMany({ where: { OR: [{ receiptId: { in: receiptIds } }, { receivableId: { in: receivableIds } }] } });
  // 预付款流水引用到账单，留存流水引用结算单；两者都必须先于被引用对象删除。
  await prisma.ownerAdvanceMovement.deleteMany({ where: { projectId } });
  await prisma.ownerRetentionMovement.deleteMany({ where: { projectId } });
  await prisma.ownerReceipt.deleteMany({ where: { id: { in: receiptIds } } });
  await prisma.ownerReceivableSchedule.deleteMany({ where: { receivableId: { in: receivableIds } } });
  await prisma.ownerReceivable.deleteMany({ where: { id: { in: receivableIds } } });
  await prisma.ownerSettlementPosting.deleteMany({ where: { projectId } });
  await prisma.ownerSettlementLine.deleteMany({ where: { settlementId: { in: ownerSettlementIds } } });
  await prisma.ownerContractSettlement.deleteMany({ where: { id: { in: ownerSettlementIds } } });

  await prisma.progressPayment.deleteMany({ where: { progressBill: { projectId } } });
  await prisma.progressBill.deleteMany({ where: { projectId } });
  await prisma.change.deleteMany({ where: { projectId } });
  await prisma.budgetItem.deleteMany({ where: { projectId } });
  await prisma.documentSequence.deleteMany({ where: { key: { startsWith: `${projectId}:` } } });
  await prisma.auditLog.deleteMany({ where: { projectId } });
  await prisma.projectMember.deleteMany({ where: { projectId } });
  await prisma.mainContract.deleteMany({ where: { projectId } });
  await prisma.project.delete({ where: { id: projectId } });

  const evidenceRoot = resolve(process.env.EVIDENCE_STORAGE_DIR ?? resolve(process.cwd(), 'data', 'evidence'));
  const evidenceDir = resolve(evidenceRoot, projectId);
  if (evidenceDir.startsWith(evidenceRoot) && existsSync(evidenceDir)) await rm(evidenceDir, { recursive: true, force: true });
  console.log(`  清理旧演示项目：${projectId}`);
}

/* ---------------- 造数 ---------------- */

async function ensureReviewer(admin: ReturnType<typeof client>) {
  const users = await admin<any[]>('GET', '/auth/users').catch(() => [] as any[]);
  const list = Array.isArray(users) ? users : [];
  if (!list.some((user) => String(user.email).toLowerCase() === REVIEWER.email)) {
    await admin('POST', '/auth/users', { name: REVIEWER.name, email: REVIEWER.email, password: REVIEWER.password });
  }
  return login(REVIEWER.email, REVIEWER.password);
}

async function main() {
  const adminToken = await login(ADMIN.email, ADMIN.password);
  const admin = client(adminToken);
  console.log('演示数据：完整业务链路开始');
  await cleanup();
  const reviewerToken = await ensureReviewer(admin);
  const reviewer = client(reviewerToken);

  /* 往来单位 */
  const parties: Record<string, string> = {};
  const partyVerificationNote = '演示数据：营业执照与开户信息已人工核对。';
  for (const [key, name, role] of [
    ['owner', PROJECT.ownerName, 'OWNER'],
    ['labor', '宏达建筑劳务有限公司', 'LABOR_SUBCONTRACTOR'],
    ['mep', '中衡机电安装工程有限公司', 'PROFESSIONAL_SUBCONTRACTOR'],
    ['steel', '恒瑞钢材贸易有限公司', 'MATERIAL_SUPPLIER'],
    ['pile', '筑基基础工程有限公司', 'PROFESSIONAL_SUBCONTRACTOR'],
    ['fitout', '锦程装饰工程有限公司', 'PROFESSIONAL_SUBCONTRACTOR'],
  ] as const) {
    const existing = await admin<any[]>('GET', `/parties?search=${encodeURIComponent(name)}`).catch(() => [] as any[]);
    const found = (Array.isArray(existing) ? existing : []).find((row) => row.name === name);
    if (found) {
      // 上一次跑批可能留下了未核验的档案，这里补齐而不是新建重复档案。
      if (!found.identityVerified) await admin('PATCH', `/parties/${found.id}`, { identityVerified: true, identityVerificationNote: partyVerificationNote });
      parties[key] = found.id;
    } else {
      parties[key] = (await admin<{ id: string }>('POST', '/parties', { name, roles: [role], identityVerified: true, identityVerificationNote: partyVerificationNote })).id;
    }
  }
  step(`往来单位 ${Object.keys(parties).length} 家`);

  /* 项目与主合同 */
  const project = await admin<{ id: string }>('POST', '/projects', {
    name: PROJECT.name, code: PROJECT.code, type: 'HOUSING', ownerName: PROJECT.ownerName, ownerPartyId: parties.owner,
    contractAmount: PROJECT.contractAmount, startDate: iso(PROJECT.startDate), plannedEndDate: iso(PROJECT.plannedEndDate),
    address: PROJECT.address, managerName: PROJECT.managerName, status: 'CONSTRUCTION',
  });
  const projectId = project.id;
  const members = await admin<any[]>('GET', '/auth/users');
  const adminUser = (members ?? []).find((user) => String(user.email).toLowerCase() === ADMIN.email);
  const reviewerUser = (members ?? []).find((user) => String(user.email).toLowerCase() === REVIEWER.email);
  if (adminUser) await admin('POST', `/projects/${projectId}/members`, { userId: adminUser.id, role: 'OWNER' }).catch(() => null);
  if (reviewerUser) await admin('POST', `/projects/${projectId}/members`, { userId: reviewerUser.id, role: 'MANAGER' }).catch(() => null);
  step(`项目 ${PROJECT.code}（合同额 ${money(PROJECT.contractAmount)}）`);

  await admin('PUT', `/projects/${projectId}/contracts/main`, {
    counterpartyPartyId: parties.owner, counterpartyName: PROJECT.ownerName, contractNo: `${PROJECT.code}-HT-01`,
    name: '锦澜花园二期住宅施工总承包合同', signedAt: iso('2026-02-10T00:00:00.000Z'), amount: PROJECT.contractAmount,
    taxIncluded: true, retentionRate: 0.03, advanceDeductionRate: 0.05,
    paymentTerms: '按月计量，业主核定后 30 日内支付至 80%，竣工结算后支付至 97%，质保金 3% 缺陷责任期满支付。',
  });
  step('主合同（留存 3%，预付款 5%）');

  /* 目标成本清单 */
  const budgetPlan = [
    { code: '01', name: '土建工程', total: 0, level: 1 },
    { code: '0101', name: '桩基与基础', parent: '01', total: 3_200_000 },
    { code: '0102', name: '主体结构', parent: '01', total: 9_800_000 },
    { code: '0103', name: '砌体与粗装修', parent: '01', total: 4_000_000 },
    { code: '02', name: '机电安装', total: 0, level: 1 },
    { code: '0201', name: '电气安装', parent: '02', total: 3_600_000 },
    { code: '0202', name: '给排水', parent: '02', total: 2_400_000 },
    { code: '0203', name: '暖通', parent: '02', total: 1_800_000 },
    { code: '03', name: '措施与现场', total: 0, level: 1 },
    { code: '0301', name: '措施费', parent: '03', total: 800_000 },
    { code: '0302', name: '现场管理费', parent: '03', total: 400_000 },
  ] as const;
  const budgetIds: Record<string, string> = {};
  for (const [index, item] of budgetPlan.entries()) {
    const created = await admin<{ id: string }>('POST', `/projects/${projectId}/budget/items`, {
      parentId: 'parent' in item ? budgetIds[(item as { parent: string }).parent] : null,
      code: item.code, name: item.name,
      totalPrice: item.total ?? undefined, sortOrder: index + 1,
      ...(item.total ? { quantity: 1, unitPrice: item.total, unit: '项' } : {}),
    });
    budgetIds[item.code] = created.id;
  }
  const budgetTotal = budgetPlan.reduce((sum, item) => sum + (item.total ?? 0), 0);
  step(`目标成本清单 11 项，末级合计 ${money(budgetTotal)}`);

  /* 变更签证 */
  const change1 = await admin<{ id: string }>('POST', `/projects/${projectId}/changes`, {
    code: 'BG-2026-001', name: '地下室底板局部增厚', type: 'ENGINEERING_CHANGE', direction: 'INCREASE',
    occurredAt: iso('2026-05-18T00:00:00.000Z'), description: '业主指令地下室底板按抗浮复核结果局部增厚 200mm。',
    submittedAmount: 380_000,
  });
  await admin('PATCH', `/projects/${projectId}/changes/${change1.id}/status`, { status: 'SUBMITTED' });
  await reviewer('PATCH', `/projects/${projectId}/changes/${change1.id}/status`, { status: 'UNDER_REVIEW' });
  await reviewer('PATCH', `/projects/${projectId}/changes/${change1.id}/status`, { status: 'CONFIRMED', approvedAmount: 350_000, decisionNote: '按合同单价组价，核减后确认。' });
  await admin('POST', `/projects/${projectId}/changes/${change1.id}/external-confirmation`, {
    evidenceClass: 'B', evidenceAssessment: 'READY',
    externalConfirmerName: '周工', externalConfirmerAuthority: '锦澜置业 工程部经理',
    externalConfirmedAt: iso('2026-06-02T00:00:00.000Z'), externalConfirmedAmount: 350_000,
    externalConfirmationScope: '地下室底板增厚 200mm，范围为一区、二区，不含三区后浇带。',
    evidenceReference: 'JL-2026-0602-01',
    evidenceContext: '业主工程部出具的设计变更确认单，附监理签认的现场签认记录。',
    attachments: [{ fileName: '变更确认单.txt', mimeType: 'text/plain', contentBase64: Buffer.from('演示数据：业主变更确认单（JL-2026-0602-01）\n').toString('base64') }],
  });
  const change1After = await admin<any[]>('GET', `/projects/${projectId}/changes`).then((rows) => (Array.isArray(rows) ? rows : []).find((row) => row.id === change1.id));
  if (change1After?.externalConfirmationStatus !== 'EFFECTIVE') throw new Error(`变更未生效：${change1After?.externalConfirmationStatus}`);
  step('变更 BG-2026-001 外部确认生效（+350,000）');

  const change2 = await admin<{ id: string }>('POST', `/projects/${projectId}/changes`, {
    code: 'BG-2026-002', name: '外立面石材改铝板', type: 'ENGINEERING_CHANGE', direction: 'INCREASE',
    occurredAt: iso('2026-10-12T00:00:00.000Z'), description: '业主口头要求外立面由石材调整为铝板幕墙，尚未签署确认单。',
    submittedAmount: 260_000,
  });
  await admin('PATCH', `/projects/${projectId}/changes/${change2.id}/status`, { status: 'SUBMITTED' });
  await reviewer('PATCH', `/projects/${projectId}/changes/${change2.id}/status`, { status: 'UNDER_REVIEW' });
  step('变更 BG-2026-002 待外部确认（+260,000 敞口）');

  await admin('POST', `/projects/${projectId}/changes`, {
    code: 'BG-2026-003', name: '取消地下室坡道装饰', type: 'ENGINEERING_CHANGE', direction: 'DECREASE',
    occurredAt: iso('2026-10-25T00:00:00.000Z'), description: '业主拟取消坡道装饰面层，金额待核。', submittedAmount: 120_000,
  });
  step('变更 BG-2026-003 草稿（-120,000）');

  /* 进度款 */
  const billPlan = [
    { periodNo: 1, amount: 7_900_000, approved: 7_600_000, received: 7_600_000, applyDate: '2026-05-05' },
    { periodNo: 2, amount: 9_100_000, approved: 8_900_000, received: 8_900_000, applyDate: '2026-07-05' },
    { periodNo: 3, amount: 7_400_000, approved: 7_200_000, received: 6_500_000, applyDate: '2026-09-05' },
    { periodNo: 4, amount: 5_500_000, approved: 5_300_000, received: 0, applyDate: '2026-11-05' },
  ];
  let certified = 0;
  let received = 0;
  for (const bill of billPlan) {
    const created = await admin<{ id: string }>('POST', `/projects/${projectId}/progress-bills`, {
      periodNo: bill.periodNo, applyDate: iso(`${bill.applyDate}T00:00:00.000Z`), measureDate: iso(`${bill.applyDate}T00:00:00.000Z`),
      amount: bill.amount, notes: `第 ${bill.periodNo} 期计量申报`,
    });
    await admin('PATCH', `/projects/${projectId}/progress-bills/${created.id}/status`, { status: 'SUBMITTED' });
    await admin('PATCH', `/projects/${projectId}/progress-bills/${created.id}/status`, { status: 'UNDER_REVIEW' });
    await admin('PATCH', `/projects/${projectId}/progress-bills/${created.id}/status`, { status: 'APPROVED', approvedAmount: bill.approved });
    if (bill.received > 0) {
      await admin('POST', `/projects/${projectId}/progress-bills/${created.id}/payments`, {
        amount: bill.received, paidAt: iso(`${bill.applyDate}T00:00:00.000Z`),
        referenceNo: `SK-P${bill.periodNo}`, notes: '业主进度款到账',
      });
    }
    certified += bill.approved;
    received += bill.received;
  }
  step(`进度款 4 期，核定 ${money(certified)}，到账 ${money(received)}`);

  // 进度款应收在审批生成时没有到期日，只能在还没有到账前补录分期；已有到账就锁定了。
  const financeAfterBills = await admin<any>('GET', `/projects/${projectId}/owner-finance`);
  const period4Receivable = (financeAfterBills.receivables ?? []).find((row: any) => row.type === 'PROGRESS_BILL' && Number(row.netAmount) === 5_300_000);
  if (!period4Receivable) throw new Error('未找到第 4 期进度款应收');
  await admin('PUT', `/projects/${projectId}/owner-finance/receivables/${period4Receivable.id}/schedules`, {
    schedules: [
      { scheduleNo: '01', dueAt: iso('2026-12-10T00:00:00.000Z'), amount: 3_000_000, notes: '第 4 期进度款首期约定付款' },
      { scheduleNo: '02', dueAt: iso('2027-02-10T00:00:00.000Z'), amount: 2_300_000, notes: '第 4 期进度款尾期约定付款' },
    ],
  });
  step('第 4 期进度款应收补录到期安排 2 期');

  /* 业主预付款与最终结算 */
  await admin('POST', `/projects/${projectId}/owner-finance/advances`, {
    amount: 1_600_000, receivedAt: iso('2026-03-25T00:00:00.000Z'), referenceNo: 'YFK-2026-01', notes: '合同价款 5% 预付款',
  });
  step('业主预付款 1,600,000');

  const ownerSettlement = await admin<{ id: string }>('POST', `/projects/${projectId}/owner-finance/settlements`, {
    type: 'FINAL', submittedAmount: 32_350_000, dueAt: iso('2026-12-20T00:00:00.000Z'),
    notes: '竣工结算报审，含已生效变更 350,000。',
    lines: [
      { description: '合同内工程量结算', quantity: 1, unit: '项', unitPrice: 32_000_000, amount: 32_000_000 },
      { description: '已生效变更结算', quantity: 1, unit: '项', unitPrice: 350_000, amount: 350_000 },
    ],
  });
  await admin('POST', `/projects/${projectId}/owner-finance/settlements/${ownerSettlement.id}/action`, { action: 'SUBMIT' });
  await reviewer('POST', `/projects/${projectId}/owner-finance/settlements/${ownerSettlement.id}/action`, { action: 'APPROVE' });
  await admin('POST', `/projects/${projectId}/owner-finance/settlements/${ownerSettlement.id}/action`, {
    action: 'CONFIRM', confirmedAmount: 32_350_000, confirmationReference: 'JL-JS-2026-001', confirmedAt: iso('2026-11-20T00:00:00.000Z'),
    dueAt: iso('2026-12-20T00:00:00.000Z'), advanceDeductionAmount: 1_600_000, retentionAmount: 970_500, otherDeductionAmount: 0,
  });
  await admin('POST', `/projects/${projectId}/owner-finance/settlements/${ownerSettlement.id}/action`, { action: 'POST' });
  const ownerFinance = await admin<any>('GET', `/projects/${projectId}/owner-finance`);
  const finalReceivable = (ownerFinance.receivables ?? []).find((row: any) => row.type === 'FINAL_SETTLEMENT');
  if (!finalReceivable) throw new Error('最终结算未生成应收');
  step(`业主最终结算过账，净应收 ${money(Number(finalReceivable.netAmount))}`);

  await admin('POST', `/projects/${projectId}/owner-finance/receivables/${finalReceivable.id}/receipts`, {
    amount: 400_000, receivedAt: iso('2026-11-28T00:00:00.000Z'), referenceNo: 'SK-JS-01', notes: '结算款首笔到账',
  });
  step('结算应收到账 400,000');

  // 合同外增项走调整结算：最终结算过账后只能用调整单修正。
  const ownerAdjustment = await admin<{ id: string }>('POST', `/projects/${projectId}/owner-finance/settlements`, {
    type: 'ADJUSTMENT', submittedAmount: 600_000, dueAt: iso('2027-01-15T00:00:00.000Z'),
    notes: '地下室抗浮加固增项结算调整',
  });
  await admin('POST', `/projects/${projectId}/owner-finance/settlements/${ownerAdjustment.id}/action`, { action: 'SUBMIT' });
  await reviewer('POST', `/projects/${projectId}/owner-finance/settlements/${ownerAdjustment.id}/action`, { action: 'APPROVE' });
  await admin('POST', `/projects/${projectId}/owner-finance/settlements/${ownerAdjustment.id}/action`, {
    action: 'CONFIRM', confirmedAmount: 600_000, confirmationReference: 'JL-TZ-2026-001', confirmedAt: iso('2026-11-25T00:00:00.000Z'),
    dueAt: iso('2027-01-15T00:00:00.000Z'), advanceDeductionAmount: 0, retentionAmount: 0, otherDeductionAmount: 0,
  });
  await admin('POST', `/projects/${projectId}/owner-finance/settlements/${ownerAdjustment.id}/action`, { action: 'POST' });
  step('业主增项调整结算 +600,000 已过账');

  /* 分供合同 */
  const downstreamPlan = [
    { key: 'labor', contractNo: 'FB-2026-01', name: '主体结构劳务分包合同', type: 'LABOR_SUBCONTRACT', party: parties.labor, counterpartyName: '宏达建筑劳务有限公司', originalAmount: 6_800_000, signedAt: '2026-03-18', status: 'ACTIVE' },
    { key: 'steel', contractNo: 'CL-2026-01', name: '钢筋材料采购合同', type: 'MATERIAL_PURCHASE', party: parties.steel, counterpartyName: '恒瑞钢材贸易有限公司', originalAmount: 5_400_000, signedAt: '2026-03-12', status: 'ACTIVE' },
    { key: 'mep', contractNo: 'ZY-2026-02', name: '机电安装专业分包合同', type: 'PROFESSIONAL_SUBCONTRACT', party: parties.mep, counterpartyName: '中衡机电安装工程有限公司', originalAmount: 4_200_000, signedAt: '2026-04-08', status: 'COMPLETED' },
    { key: 'pile', contractNo: 'ZY-2026-01', name: '桩基工程专业分包合同', type: 'PROFESSIONAL_SUBCONTRACT', party: parties.pile, counterpartyName: '筑基基础工程有限公司', originalAmount: 3_000_000, signedAt: '2026-03-05', status: 'ACTIVE' },
    { key: 'fitout', contractNo: 'ZS-2026-01', name: '室内精装修分包合同（待签）', type: 'PROFESSIONAL_SUBCONTRACT', party: parties.fitout, counterpartyName: '锦程装饰工程有限公司', originalAmount: 2_100_000, signedAt: '2026-10-20', status: 'DRAFT' },
  ] as const;
  const contracts: Record<string, string> = {};
  for (const item of downstreamPlan) {
    const created = await admin<{ id: string }>('POST', `/projects/${projectId}/downstream-contracts`, {
      contractNo: item.contractNo, name: item.name, type: item.type, counterpartyName: item.counterpartyName,
      counterpartyPartyId: item.party ?? null, signedAt: iso(`${item.signedAt}T00:00:00.000Z`), startDate: iso(`${item.signedAt}T00:00:00.000Z`),
      originalAmount: item.originalAmount, taxIncluded: true, scope: `${item.name}约定范围内的全部工作内容。`,
      paymentTerms: '按月计量，业主付款后 15 日内按比例支付，结算后付至 95%，质保金 5%。',
    });
    contracts[item.key] = created.id;
    if (item.status !== 'DRAFT') {
      await admin('PATCH', `/projects/${projectId}/downstream-contracts/${created.id}/status`, { status: 'ACTIVE' });
    }
    if (item.status === 'COMPLETED') {
      await admin('PATCH', `/projects/${projectId}/downstream-contracts/${created.id}/status`, { status: 'COMPLETED' });
    }
  }
  step(`分供合同 5 份（1 份草稿，1 份完工待结算）`);

  await admin('POST', `/projects/${projectId}/downstream-contracts/${contracts.labor}/adjustments`, {
    code: 'BC-01', name: '主体结构劳务补充协议（一）', direction: 'INCREASE', amount: 180_000,
    effectiveAt: iso('2026-08-10T00:00:00.000Z'), documentReference: 'BC-2026-01', notes: '增加三层以上模板支撑人工。',
  });
  for (const [index, plan] of [
    { stageName: '开工预付款', dueAt: '2026-04-10', plannedAmount: 600_000 },
    { stageName: '主体封顶计量', dueAt: '2026-09-10', plannedAmount: 3_600_000 },
    { stageName: '结算尾款', dueAt: '2026-12-31', plannedAmount: 2_780_000 },
  ].entries()) {
    await admin('POST', `/projects/${projectId}/downstream-contracts/${contracts.labor}/payment-plans`, {
      stageName: plan.stageName, dueAt: iso(`${plan.dueAt}T00:00:00.000Z`), plannedAmount: plan.plannedAmount,
      notes: `第 ${index + 1} 期付款计划`,
    });
  }
  await admin('POST', `/projects/${projectId}/downstream-contracts/${contracts.labor}/payments`, {
    type: 'ADVANCE', amount: 600_000, paidAt: iso('2026-04-12T00:00:00.000Z'), referenceNo: 'FK-2026-001', notes: '劳务预付款',
  });
  step('劳务合同补充协议 +180,000，付款计划 3 期，预付款 600,000');

  // 还没结算出应付的合同靠付款计划进入资金计划：这两份是资金计划支出侧的主要来源。
  for (const plan of [
    { key: 'steel', stageName: '首批钢材到货', dueAt: '2026-11-20', plannedAmount: 1_800_000 },
    { key: 'steel', stageName: '主体结构钢材', dueAt: '2026-12-18', plannedAmount: 2_400_000 },
    { key: 'steel', stageName: '尾款', dueAt: '2027-01-25', plannedAmount: 1_200_000 },
    { key: 'pile', stageName: '桩基完工计量', dueAt: '2026-12-05', plannedAmount: 1_700_000 },
    { key: 'pile', stageName: '桩基尾款', dueAt: '2027-01-15', plannedAmount: 1_300_000 },
  ]) {
    await admin('POST', `/projects/${projectId}/downstream-contracts/${contracts[plan.key]}/payment-plans`, {
      stageName: plan.stageName, dueAt: iso(`${plan.dueAt}T00:00:00.000Z`), plannedAmount: plan.plannedAmount,
    });
  }
  step('材料、桩基合同付款计划 5 期');

  /* 分供阶段结算 → 应付 → 付款 */
  const laborSettlement = await admin<{ id: string }>('POST', `/projects/${projectId}/downstream-contracts/${contracts.labor}/settlements`, {
    type: 'PROGRESS', submittedAmount: 5_600_000, advanceRecoveryAmount: 400_000, retentionAmount: 280_000,
    dueAt: iso('2026-10-20T00:00:00.000Z'), notes: '主体结构劳务第三期计量结算',
    lines: [
      { description: '主体结构钢筋绑扎与模板', quantity: 1, unit: '项', unitPrice: 3_900_000, amount: 3_900_000 },
      { description: '混凝土浇筑与养护', quantity: 1, unit: '项', unitPrice: 1_700_000, amount: 1_700_000 },
    ],
  });
  await admin('POST', `/projects/${projectId}/downstream-contracts/${contracts.labor}/settlements/${laborSettlement.id}/submit`);
  await reviewer('POST', `/projects/${projectId}/downstream-contracts/${contracts.labor}/settlements/${laborSettlement.id}/approve`);
  await admin('POST', `/projects/${projectId}/downstream-contracts/${contracts.labor}/settlements/${laborSettlement.id}/confirm`, {
    confirmedAmount: 5_600_000, confirmationReference: 'FB-JS-2026-03', confirmationDate: iso('2026-10-18T00:00:00.000Z'),
  });
  const laborPosted = await admin<any>('POST', `/projects/${projectId}/downstream-contracts/${contracts.labor}/settlements/${laborSettlement.id}/post`);
  const laborPayable = laborPosted.payable;
  if (!laborPayable) throw new Error('劳务结算未生成应付');
  step(`劳务阶段结算过账，应付净额 ${money(Number(laborPayable.netAmount))}`);

  const laborSchedule = (laborPayable.schedules ?? [])[0];
  if (!laborSchedule) throw new Error('劳务应付未生成到期安排');
  await admin('POST', `/projects/${projectId}/downstream-contracts/${contracts.labor}/payments`, {
    type: 'PROGRESS', amount: 3_000_000, paidAt: iso('2026-10-28T00:00:00.000Z'), referenceNo: 'FK-2026-018', notes: '劳务进度款',
    allocations: [{ payableId: laborPayable.id, payableScheduleId: laborSchedule.id, amount: 3_000_000 }],
  });
  step('劳务应付付款核销 3,000,000');

  /* 完工合同最终结算 → 应付 → 付款 → 发票 */
  const mepSettlement = await admin<{ id: string }>('POST', `/projects/${projectId}/downstream-contracts/${contracts.mep}/settlements`, {
    type: 'FINAL', submittedAmount: 4_150_000, retentionAmount: 207_500, dueAt: iso('2026-11-15T00:00:00.000Z'),
    notes: '机电安装完工结算', lines: [{ description: '机电安装完工结算', quantity: 1, unit: '项', unitPrice: 4_150_000, amount: 4_150_000 }],
  });
  await admin('POST', `/projects/${projectId}/downstream-contracts/${contracts.mep}/settlements/${mepSettlement.id}/submit`);
  await reviewer('POST', `/projects/${projectId}/downstream-contracts/${contracts.mep}/settlements/${mepSettlement.id}/approve`);
  await admin('POST', `/projects/${projectId}/downstream-contracts/${contracts.mep}/settlements/${mepSettlement.id}/confirm`, {
    confirmedAmount: 4_150_000, confirmationReference: 'ZY-JS-2026-02', confirmationDate: iso('2026-11-10T00:00:00.000Z'),
  });
  const mepPosted = await admin<any>('POST', `/projects/${projectId}/downstream-contracts/${contracts.mep}/settlements/${mepSettlement.id}/post`);
  const mepPayable = mepPosted.payable;
  const mepSchedule = (mepPayable?.schedules ?? [])[0];
  if (!mepPayable || !mepSchedule) throw new Error('机电结算未生成应付及分期');
  step(`机电完工结算过账，应付净额 ${money(Number(mepPayable.netAmount))}，合同转结算已确认`);

  const mepContract = await admin<{ items: any[] }>('GET', `/projects/${projectId}/downstream-contracts`).then((payload) => (payload.items ?? []).find((row) => row.id === contracts.mep));
  if (mepContract?.status !== 'SETTLED') throw new Error(`完工结算后合同状态应为 SETTLED，实际 ${mepContract?.status}`);

  await admin('POST', `/projects/${projectId}/downstream-contracts/${contracts.mep}/payments`, {
    type: 'PROGRESS', amount: 2_500_000, paidAt: iso('2026-11-18T00:00:00.000Z'), referenceNo: 'FK-2026-022', notes: '机电结算款',
    allocations: [{ payableId: mepPayable.id, payableScheduleId: mepSchedule.id, amount: 2_500_000 }],
  });
  const invoice = await admin<{ id: string }>('POST', `/projects/${projectId}/downstream-contracts/${contracts.mep}/invoices`, {
    invoiceNo: '0430020261118001', invoiceDate: iso('2026-11-18T00:00:00.000Z'), amount: 3_000_000, taxAmount: 247_706.42, taxIncluded: true,
    notes: '机电安装工程进度发票',
  });
  await admin('POST', `/projects/${projectId}/downstream-contracts/${contracts.mep}/invoices/${invoice.id}/verify`, { status: 'VERIFIED', verificationNote: '票面信息与合同一致。' });
  await admin('POST', `/projects/${projectId}/downstream-contracts/${contracts.mep}/invoices/${invoice.id}/allocations`, { payableId: mepPayable.id, amount: 2_000_000, notes: '发票与应付勾稽' });
  step('机电付款 2,500,000、发票 3,000,000 验真并勾稽 2,000,000');

  /* 实际成本 */
  const costPlan: Array<[string, string, string, number, string, string | null, string]> = [
    ['0101', 'SUBCONTRACT', '桩基分包计量成本', 3_000_000, '2026-04-20', 'pile', '桩基工程分包计量'],
    ['0101', 'MACHINE', '桩机租赁与进出场', 200_000, '2026-04-10', null, '旋挖钻机租赁'],
    ['0102', 'SUBCONTRACT', '主体结构劳务计量成本', 6_900_000, '2026-10-18', 'labor', '主体结构劳务计量'],
    ['0102', 'MATERIAL', '钢筋采购成本', 2_400_000, '2026-06-25', 'steel', 'HRB400 钢筋 480 吨'],
    ['0102', 'MACHINE', '塔吊与施工电梯租赁', 500_000, '2026-07-15', null, '塔吊 2 台、施工电梯 1 台'],
    ['0103', 'LABOR', '砌体与抹灰人工费', 2_000_000, '2026-09-20', null, '砌体与粗装修人工'],
    ['0103', 'MATERIAL', '砌块与砂浆材料', 1_300_000, '2026-09-10', null, '蒸压加气块与干混砂浆'],
    ['0201', 'SUBCONTRACT', '机电安装分包计量成本', 3_300_000, '2026-11-10', 'mep', '机电安装工程计量'],
    ['0201', 'MACHINE', '临时用电与配电箱租赁', 600_000, '2026-08-20', null, '临电设施租赁'],
    ['0202', 'SUBCONTRACT', '给排水安装分包成本', 900_000, '2026-11-10', 'mep', '给排水安装计量'],
    ['0202', 'MATERIAL', '给排水管材与阀门', 800_000, '2026-10-05', null, 'PPR 管材、阀门'],
    ['0203', 'MATERIAL', '通风管道与设备', 1_200_000, '2026-10-25', null, '风管、风机盘管'],
    ['0301', 'INDIRECT', '安全文明施工措施费', 800_000, '2026-11-02', null, '安全文明施工措施'],
    ['0302', 'INDIRECT', '现场管理人员薪酬分摊', 300_000, '2026-11-02', null, '现场管理人员月度分摊'],
  ];
  for (const [budgetCode, type, description, amount, date, contractKey, notes] of costPlan) {
    await admin('POST', `/projects/${projectId}/costs`, {
      type, date: iso(`${date}T00:00:00.000Z`), amount, description, notes,
      budgetItemId: budgetIds[budgetCode], downstreamContractId: contractKey ? contracts[contractKey] : null,
      taxRate: type === 'MATERIAL' ? 13 : type === 'SUBCONTRACT' ? 9 : null,
      vendorName: contractKey === 'steel' ? '恒瑞钢材贸易有限公司' : contractKey === 'labor' ? '宏达建筑劳务有限公司' : null,
    });
  }
  const totalCost = costPlan.reduce((sum, item) => sum + item[3], 0);
  step(`实际成本 ${costPlan.length} 笔，合计 ${money(totalCost)}`);

  /* 交叉校验：派生数据必须与业务事实一致 */
  const analysis = await admin<any>('GET', `/projects/${projectId}/analysis/three-way`);
  const finance = await admin<any>('GET', `/projects/${projectId}/downstream-finance`);
  const cashflow = await admin<any>('GET', `/projects/${projectId}/analysis/cashflow`);
  const checks: Array<[string, boolean, string]> = [
    ['合同额含生效变更', Number(analysis.contractAmount) === 32_350_000, `${analysis.contractAmount}`],
    ['目标成本合计', Number(analysis.targetCost) === budgetTotal, `${analysis.targetCost}`],
    ['实际成本合计', Number(analysis.actualCost) === totalCost, `${analysis.actualCost}`],
    ['核定产值合计', Number(analysis.billSummary?.certifiedAmount) === certified, `${analysis.billSummary?.certifiedAmount}`],
    ['完工估算可计算', analysis.eac?.status === 'READY', `${analysis.eac?.status} / ${analysis.eac?.completionRatio}`],
    ['应付未付余额', Number(finance.summary?.openPayableAmount) > 0, `${finance.summary?.openPayableAmount}`],
    ['留存余额已计提', Number(finance.summary?.retentionBalanceAmount) > 0, `${finance.summary?.retentionBalanceAmount}`],
    ['资金计划收入侧有到期金额', Number(cashflow.window?.inflow) > 0, `${cashflow.window?.inflow}`],
    ['资金计划支出侧有到期金额', Number(cashflow.window?.outflow) > 0, `${cashflow.window?.outflow}`],
    ['付款计划只计未结算合同', cashflow.sourceCounts?.plan === 5, `${cashflow.sourceCounts?.plan} 期计划计入（劳务合同已有应付，其 3 期被跳过）`],
  ];
  const failed = checks.filter(([, ok]) => !ok);

  console.log('\n关键数字');
  console.log(`  合同额（含变更）      ${money(Number(analysis.contractAmount))}`);
  console.log(`  目标成本              ${money(Number(analysis.targetCost))}`);
  console.log(`  实际成本              ${money(Number(analysis.actualCost))}`);
  console.log(`  核定产值              ${money(Number(analysis.billSummary?.certifiedAmount))}`);
  console.log(`  产值完成比            ${(Number(analysis.eac?.completionRatio ?? 0) * 100).toFixed(2)}%`);
  console.log(`  完工估算 EAC          ${analysis.eac?.valuation ? `${money(analysis.eac.valuation.low)} – ${money(analysis.eac.valuation.high)}` : analysis.eac?.status}`);
  console.log(`  预计利润率            ${analysis.eac?.margin ? `${(analysis.eac.margin.likely * 100).toFixed(2)}%` : '—'}`);
  console.log(`  应付未付              ${money(Number(finance.summary?.openPayableAmount))}`);
  console.log(`  质保金余额            ${money(Number(finance.summary?.retentionBalanceAmount))}`);
  console.log('\n资金计划（未来 6 个月）');
  for (const bucket of cashflow.buckets ?? []) console.log(`  ${bucket.key}  应收 ${money(bucket.inflow)}  应付 ${money(bucket.outflow)}  净 ${money(bucket.net)}`);
  console.log(`  逾期  应收 ${money(cashflow.overdue?.inflow ?? 0)}  应付 ${money(cashflow.overdue?.outflow ?? 0)}`);
  console.log(`  未设到期日  应收 ${money(cashflow.unscheduled?.inflow ?? 0)}  应付 ${money(cashflow.unscheduled?.outflow ?? 0)}`);
  console.log(`\n自检 ${checks.length - failed.length}/${checks.length} 项通过`);
  for (const [name, ok, actual] of checks) console.log(`  ${ok ? '✓' : '✗'} ${name}：${actual}`);
  console.log(`\n项目编号 ${PROJECT.code}，项目 id ${projectId}`);
  if (failed.length) throw new Error(`自检未通过：${failed.map(([name]) => name).join('、')}`);
}

main()
  .catch((error) => {
    console.error('\n演示数据生成失败：', error instanceof ApiError ? `${error.message} ${JSON.stringify(error.body ?? {})}` : error);
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });
