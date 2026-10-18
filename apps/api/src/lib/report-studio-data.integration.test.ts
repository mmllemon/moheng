import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { AuthUser } from './auth.js';
import { prisma } from './prisma.js';
import { loadReportStudioDataset } from './report-studio-data.js';
import { loadReportSnapshot } from './report-data.js';

const enabled = process.env.REPORT_STUDIO_DATA_TESTS === 'true';

test('Report Studio scopes company rows, financial totals, and project previews to authorized memberships', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated PostgreSQL test database');
  assert.notEqual(testDatabaseUrl, process.env.PRODUCTION_DATABASE_URL, 'refusing to run against PRODUCTION_DATABASE_URL');
  const looksIsolated = testDatabaseUrl.includes('localhost') || testDatabaseUrl.includes('127.0.0.1') ||
    ((testDatabaseUrl.startsWith('postgres://') || testDatabaseUrl.startsWith('postgresql://')) && /(?:test|ci)/i.test(testDatabaseUrl));
  assert.ok(looksIsolated, 'refusing a URL that does not look isolated');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const projectIds: string[] = [];
  const downstreamContractIds: string[] = [];
  let userId: string | undefined;

  try {
    const user = await prisma.user.create({
      data: {
        name: `Report Scope Gate ${suffix}`,
        email: `report-scope-${suffix}@example.invalid`,
        passwordHash: 'test-only-not-a-login-password',
        role: 'USER',
        dataScope: 'ASSIGNED_PROJECTS',
      },
    });
    userId = user.id;
    const projectA = await prisma.project.create({
      data: {
        name: `Authorized Scope Project ${suffix}`,
        code: `RSG-A-${suffix}`,
        ownerName: 'Scope Gate Owner',
        contractAmount: '1000.00',
        originalContractAmount: '1000.00',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    projectIds.push(projectA.id);
    const projectB = await prisma.project.create({
      data: {
        name: `Unauthorized Scope Project ${suffix}`,
        code: `RSG-B-${suffix}`,
        ownerName: 'Scope Gate Owner',
        contractAmount: '2000.00',
        originalContractAmount: '2000.00',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    projectIds.push(projectB.id);

    await prisma.projectMember.create({
      data: { projectId: projectA.id, userId: user.id, role: 'ESTIMATOR' },
    });
    const authorizedDownstreamContract = await prisma.downstreamContract.create({
      data: {
        projectId: projectA.id,
        contractNo: `RSG-A-C-${suffix}`,
        name: 'authorized high precision contract',
        type: 'MATERIAL_PURCHASE',
        counterpartyName: 'Scope Gate Authorized Supplier',
        originalAmount: '90071992547409.93',
        createdById: user.id,
      },
    });
    downstreamContractIds.push(authorizedDownstreamContract.id);
    await prisma.downstreamContractAdjustment.create({
      data: {
        downstreamContractId: authorizedDownstreamContract.id,
        code: `RSG-ADJ-${suffix}`,
        name: 'exact-cent precision fixture',
        direction: 'INCREASE',
        amount: '0.07',
        effectiveAt: new Date('2026-03-01T00:00:00.000Z'),
        documentReference: 'isolated PostgreSQL test fixture',
        createdById: user.id,
      },
    });
    await prisma.costEntry.create({
      data: {
        projectId: projectB.id,
        type: 'MATERIAL',
        date: new Date('2026-02-01T00:00:00.000Z'),
        amount: '9876.54',
        description: 'must not leak into company report for another project',
        createdById: user.id,
      },
    });
    const downstreamContract = await prisma.downstreamContract.create({
      data: {
        projectId: projectB.id,
        contractNo: `RSG-C-${suffix}`,
        name: 'must not leak into company downstream contract report',
        type: 'MATERIAL_PURCHASE',
        counterpartyName: 'Scope Gate Supplier',
        originalAmount: '4321.00',
        createdById: user.id,
      },
    });
    downstreamContractIds.push(downstreamContract.id);
    await prisma.downstreamContractPayment.create({
      data: {
        downstreamContractId: downstreamContract.id,
        type: 'PROGRESS',
        amount: '1234.56',
        paidAt: new Date('2026-03-01T00:00:00.000Z'),
        referenceNo: `RSG-P-${suffix}`,
        createdById: user.id,
      },
    });

    const actor: AuthUser = { sub: user.id, email: user.email, role: 'USER', sid: `report-scope-${suffix}` };
    const company = await loadReportStudioDataset(actor, 'COMPANY');
    const companyProjects = company.sources.companyProjects as Array<{ code: string; name: string }>;
    const companySummary = company.sources.companySummary as {
      projectCount: number;
      actualCostTotal: string | null;
      downstreamContractTotal: string | null;
      downstreamPaymentTotal: string | null;
      downstreamNetPaymentTotal: string | null;
    };
    const companyActualCosts = company.sources.companyActualCosts as Array<{ amount: string; projectCode: string }>;
    const companyDownstreamContracts = company.sources.companyDownstreamContracts as Array<{ contractNo: string; projectCode: string; effectiveAmount: string | null }>;
    const companyDownstreamPayments = company.sources.companyDownstreamPayments as Array<{ referenceNo: string; projectCode: string }>;

    assert.equal(company.accessibleProjectCount, 1);
    assert.equal(companySummary.projectCount, 1);
    assert.deepEqual(companyProjects.map((row) => row.code), [projectA.code]);
    assert.deepEqual(companyActualCosts, []);
    assert.deepEqual(companyDownstreamContracts.map((row) => row.contractNo), [authorizedDownstreamContract.contractNo], 'only the authorized project contract may appear in company report details');
    assert.equal(companyDownstreamContracts[0]?.projectCode, projectA.code);
    assert.equal(companyDownstreamContracts[0]?.effectiveAmount, '90071992547410.00', 'high-precision contract value must be exact after its adjustment');
    assert.deepEqual(companyDownstreamPayments, [], 'payments attached to an unauthorized downstream contract must not leak into company report details');
    assert.equal(companySummary.actualCostTotal, '0.00', 'another project’s cost must not affect a company summary outside the user’s project scope');
    assert.equal(companySummary.downstreamContractTotal, '90071992547410.00', 'unauthorized contract value must not affect the authorized company-scope total');
    assert.equal(companySummary.downstreamPaymentTotal, '0.00', 'another project’s payment must not affect company payment totals');
    assert.equal(companySummary.downstreamNetPaymentTotal, '0.00', 'another project’s payment must not affect company net cash flow');

    await assert.rejects(
      () => loadReportStudioDataset(actor, 'PROJECT', projectB.id),
      (error: unknown) => typeof error === 'object' && error !== null &&
        'code' in error && error.code === 'PROJECT_ACCESS_DENIED',
      'a project-level report must reject a project outside the user’s membership scope',
    );

    for (const reportKey of ['actual-cost', 'downstream-contracts', 'downstream-payables'] as const) {
      const companySnapshot = await loadReportSnapshot(reportKey, actor, {});
      assert.equal(companySnapshot.ok, true, `authorized-company scope should load ${reportKey}`);
      if (companySnapshot.ok) {
        if (reportKey === 'downstream-contracts') {
          assert.equal(companySnapshot.snapshot.rows.length, 1, 'only the authorized downstream contract should be exported');
          assert.equal(companySnapshot.snapshot.rows[0]?.[2], authorizedDownstreamContract.contractNo);
          assert.equal(companySnapshot.snapshot.rows[0]?.[8], '0.07', 'contract adjustment delta must use exact cents for large amounts');
          assert.equal(companySnapshot.snapshot.rows[0]?.[9], '90071992547410.00');
        } else {
          assert.equal(companySnapshot.snapshot.rows.length, 0, `unauthorized project rows must not leak into ${reportKey}`);
        }
        assert.equal(companySnapshot.snapshot.projectScope, '全部可访问项目');
      }

      const deniedSnapshot = await loadReportSnapshot(reportKey, actor, { projectId: projectB.id });
      assert.equal(deniedSnapshot.ok, false, `direct export of an unauthorized project must fail for ${reportKey}`);
      if (!deniedSnapshot.ok) {
        assert.equal(deniedSnapshot.status, 403);
        assert.equal(deniedSnapshot.code, 'PROJECT_ACCESS_DENIED');
      }
    }
  } finally {
    if (downstreamContractIds.length) {
      await prisma.downstreamContractPayment.deleteMany({ where: { downstreamContractId: { in: downstreamContractIds } } });
      await prisma.downstreamContractAdjustment.deleteMany({ where: { downstreamContractId: { in: downstreamContractIds } } });
      await prisma.downstreamContract.deleteMany({ where: { id: { in: downstreamContractIds } } });
    }
    if (projectIds.length) {
      await prisma.costEntry.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  }
});
