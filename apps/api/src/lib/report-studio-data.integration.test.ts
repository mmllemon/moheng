import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { AuthUser } from './auth.js';
import { prisma } from './prisma.js';
import { loadReportStudioDataset } from './report-studio-data.js';

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

    const actor: AuthUser = { sub: user.id, email: user.email, role: 'USER', sid: `report-scope-${suffix}` };
    const company = await loadReportStudioDataset(actor, 'COMPANY');
    const companyProjects = company.sources.companyProjects as Array<{ code: string; name: string }>;
    const companySummary = company.sources.companySummary as { projectCount: number; actualCostTotal: string | null };
    const companyActualCosts = company.sources.companyActualCosts as Array<{ amount: string; projectCode: string }>;

    assert.equal(company.accessibleProjectCount, 1);
    assert.equal(companySummary.projectCount, 1);
    assert.deepEqual(companyProjects.map((row) => row.code), [projectA.code]);
    assert.deepEqual(companyActualCosts, []);
    assert.equal(companySummary.actualCostTotal, '0.00', 'another project’s cost must not affect a company summary outside the user’s project scope');

    await assert.rejects(
      () => loadReportStudioDataset(actor, 'PROJECT', projectB.id),
      (error: unknown) => typeof error === 'object' && error !== null &&
        'code' in error && error.code === 'PROJECT_ACCESS_DENIED',
      'a project-level report must reject a project outside the user’s membership scope',
    );
  } finally {
    if (projectIds.length) {
      await prisma.costEntry.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  }
});
