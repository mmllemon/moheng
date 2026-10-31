import type { FastifyInstance } from 'fastify';
import { centsToMoney, moneyToCents } from '../../lib/contract-amount-math.js';
import { failure, success } from '../../lib/http.js';
import { sumCents, invoiceInput, invoiceVerifyInput, allocationInput } from './schemas.js';
import { Prisma } from '../../generated/prisma/client.js';
import { authRequired, authUser } from '../../lib/auth.js';
import { asAmount, hasProjectWriteAccess, lockContract, writeAudit } from './helpers.js';
import { prisma } from '../../lib/prisma.js';

export async function registerInvoiceRoutes(app: FastifyInstance) {
  app.post('/:projectId/downstream-contracts/:contractId/invoices', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId, contractId } = request.params as { projectId: string; contractId: string };
    if (await hasProjectWriteAccess(user.sub, user.role, projectId, reply)) return;
    const parsed = invoiceInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '发票信息填写有误', parsed.error.flatten());
    try {
      const invoice = await prisma.$transaction(async (tx) => {
        const contract = await lockContract(tx, projectId, contractId);
        if (contract.status === 'DRAFT' || contract.status === 'TERMINATED') throw new Error('CONTRACT_NOT_INVOICE_ELIGIBLE');
        const row = await tx.downstreamSupplierInvoice.create({ data: {
          downstreamContractId: contractId, invoiceNo: parsed.data.invoiceNo, invoiceDate: new Date(parsed.data.invoiceDate), amount: String(parsed.data.amount),
          taxAmount: String(parsed.data.taxAmount), taxIncluded: parsed.data.taxIncluded, notes: parsed.data.notes ?? null, createdById: user.sub,
        } });
        await writeAudit(tx, projectId, user.sub, 'DownstreamSupplierInvoice', row.id, 'SUPPLIER_INVOICE_RECORDED', { invoiceNo: row.invoiceNo, amount: String(row.amount), taxAmount: String(row.taxAmount), status: row.status });
        return row;
      });
      return reply.code(201).send(success({ ...invoice, amount: asAmount(invoice.amount), taxAmount: asAmount(invoice.taxAmount) }));
    } catch (error) {
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_FOUND') return failure(reply, 404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '分供合同不存在');
      if (error instanceof Error && error.message === 'CONTRACT_NOT_INVOICE_ELIGIBLE') return failure(reply, 409, 'CONTRACT_NOT_INVOICE_ELIGIBLE', '草稿或已终止合同不能登记新的供应商发票');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return failure(reply, 409, 'INVOICE_NO_EXISTS', '该合同下发票号码已登记');
      throw error;
    }
  });

  app.post('/:projectId/downstream-contracts/:contractId/invoices/:invoiceId/verify', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId, contractId, invoiceId } = request.params as { projectId: string; contractId: string; invoiceId: string };
    if (await hasProjectWriteAccess(user.sub, user.role, projectId, reply)) return;
    const parsed = invoiceVerifyInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '发票核验信息有误', parsed.error.flatten());
    try {
      const row = await prisma.$transaction(async (tx) => {
        await lockContract(tx, projectId, contractId);
        const existing = await tx.downstreamSupplierInvoice.findFirst({ where: { id: invoiceId, downstreamContractId: contractId } });
        if (!existing) throw new Error('INVOICE_NOT_FOUND');
        if (existing.status !== 'RECEIVED') throw new Error('INVOICE_ALREADY_PROCESSED');
        const updated = await tx.downstreamSupplierInvoice.update({ where: { id: invoiceId }, data: { status: parsed.data.status, verificationNote: parsed.data.verificationNote ?? null, verifiedAt: parsed.data.status === 'VERIFIED' ? new Date() : null } });
        await writeAudit(tx, projectId, user.sub, 'DownstreamSupplierInvoice', invoiceId, parsed.data.status === 'VERIFIED' ? 'SUPPLIER_INVOICE_VERIFIED' : 'SUPPLIER_INVOICE_REJECTED', { status: parsed.data.status, verificationNote: parsed.data.verificationNote ?? null });
        return updated;
      });
      return success({ ...row, amount: asAmount(row.amount), taxAmount: asAmount(row.taxAmount) });
    } catch (error) {
      if (error instanceof Error && error.message === 'DOWNSTREAM_CONTRACT_NOT_FOUND') return failure(reply, 404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '分供合同不存在');
      if (error instanceof Error && error.message === 'INVOICE_NOT_FOUND') return failure(reply, 404, 'INVOICE_NOT_FOUND', '发票不存在');
      if (error instanceof Error && error.message === 'INVOICE_ALREADY_PROCESSED') return failure(reply, 409, 'INVOICE_ALREADY_PROCESSED', '发票已经核验；如需更正应保留核验记录并建立更正流程');
      throw error;
    }
  });

  app.post('/:projectId/downstream-contracts/:contractId/invoices/:invoiceId/allocations', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request); const { projectId, contractId, invoiceId } = request.params as { projectId: string; contractId: string; invoiceId: string };
    if (await hasProjectWriteAccess(user.sub, user.role, projectId, reply)) return;
    const parsed = allocationInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '发票核对分配金额填写有误', parsed.error.flatten());
    try {
      const result = await prisma.$transaction(async (tx) => {
        await lockContract(tx, projectId, contractId);
        const invoice = await tx.downstreamSupplierInvoice.findFirst({ where: { id: invoiceId, downstreamContractId: contractId } });
        if (!invoice) throw new Error('INVOICE_NOT_FOUND');
        if (invoice.status !== 'VERIFIED') throw new Error('INVOICE_MUST_BE_VERIFIED');
        const payable = await tx.downstreamPayable.findFirst({ where: { id: parsed.data.payableId, downstreamContractId: contractId } });
        if (!payable) throw new Error('PAYABLE_NOT_FOUND');
        if (moneyToCents(payable.grossAmount) <= 0n) throw new Error('PAYABLE_CANNOT_RECEIVE_INVOICE');
        const invoiceAllocations = await tx.downstreamInvoiceAllocation.findMany({ where: { invoiceId } });
        const payableAllocations = await tx.downstreamInvoiceAllocation.findMany({ where: { payableId: payable.id } });
        const requested = moneyToCents(parsed.data.amount);
        const invoiceAlreadyAllocated = sumCents(invoiceAllocations.map((item) => item.amount));
        const payableAlreadyAllocated = sumCents(payableAllocations.map((item) => item.amount));
        if (invoiceAlreadyAllocated + requested > moneyToCents(invoice.amount)) throw new Error('INVOICE_ALLOCATION_EXCEEDS_INVOICE');
        if (payableAlreadyAllocated + requested > moneyToCents(payable.grossAmount)) throw new Error('INVOICE_ALLOCATION_EXCEEDS_PAYABLE');
        const allocation = await tx.downstreamInvoiceAllocation.upsert({
          where: { invoiceId_payableId: { invoiceId, payableId: payable.id } },
          create: { invoiceId, payableId: payable.id, amount: String(centsToMoney(requested)), notes: parsed.data.notes ?? null },
          update: { amount: { increment: String(centsToMoney(requested)) }, notes: parsed.data.notes ?? null },
        });
        await writeAudit(tx, projectId, user.sub, 'DownstreamInvoiceAllocation', allocation.id, 'SUPPLIER_INVOICE_ALLOCATED', { invoiceId, payableId: payable.id, amount: String(parsed.data.amount), cumulativeInvoiceAllocation: String(centsToMoney(invoiceAlreadyAllocated + requested)) });
        return allocation;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return reply.code(201).send(success({ ...result, amount: asAmount(result.amount) }));
    } catch (error) {
      const map: Record<string, [number, string, string]> = {
        DOWNSTREAM_CONTRACT_NOT_FOUND: [404, 'DOWNSTREAM_CONTRACT_NOT_FOUND', '分供合同不存在'],
        INVOICE_NOT_FOUND: [404, 'INVOICE_NOT_FOUND', '发票不存在'],
        INVOICE_MUST_BE_VERIFIED: [409, 'INVOICE_MUST_BE_VERIFIED', '发票完成核验后才能分配到应付单'],
        PAYABLE_NOT_FOUND: [404, 'PAYABLE_NOT_FOUND', '应付单不存在或不属于当前合同'],
        PAYABLE_CANNOT_RECEIVE_INVOICE: [409, 'PAYABLE_CANNOT_RECEIVE_INVOICE', '负向应付调整不能分配正向发票金额'],
        INVOICE_ALLOCATION_EXCEEDS_INVOICE: [409, 'INVOICE_ALLOCATION_EXCEEDS_INVOICE', '累计分配金额不能超过该发票价税合计金额'],
        INVOICE_ALLOCATION_EXCEEDS_PAYABLE: [409, 'INVOICE_ALLOCATION_EXCEEDS_PAYABLE', '累计分配金额不能超过该应付来源的正向结算金额'],
      };
      const mappedError = error instanceof Error ? map[error.message] : undefined;
      if (mappedError) { const [status, code, message] = mappedError; return failure(reply, status, code, message); }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return failure(reply, 409, 'INVOICE_ALLOCATION_CONFLICT', '发票分配发生并发冲突，请刷新后重试');
      throw error;
    }
  });

}
