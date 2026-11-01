import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../lib/prisma.js';

/**
 * 数据库 schema 与仓库迁移目录是否对齐。
 *
 * 用途：`/api/meta` 下发这份状态，前端在「库落后」时直接提示，
 * 而不是让每个接口都返回 500、页面统一显示"数据暂时不可用"。
 *
 * 2026-10-29 的实际故障：运行库少一条迁移（Project.workspaceRoot），
 * 代码里 35 处引用该字段，所有项目查询全 500，前端只能显示通用错误，
 * 排查靠手工跑 `prisma migrate status`。这份状态就是为了让那类问题一眼可见。
 */
export type SchemaState = {
  reachable: boolean;
  /** 仓库里的迁移总数 */
  total: number | null;
  /** 已在库中成功应用的迁移数 */
  applied: number | null;
  /** 库中缺失的迁移（相对仓库目录），最多列出 10 条 */
  pending: string[];
  /** 仓库目录里最新的迁移名 */
  latest: string | null;
  error?: string;
};

const MIGRATIONS_DIR = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'prisma', 'migrations');

let cache: { at: number; value: SchemaState } | null = null;
const CACHE_MS = 15_000;

async function listMigrationDirectories(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function listAppliedMigrations(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  return rows.map((row) => row.migration_name);
}

export async function describeSchemaState(): Promise<SchemaState> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  let value: SchemaState;
  try {
    const [directories, applied] = await Promise.all([listMigrationDirectories(), listAppliedMigrations()]);
    const appliedSet = new Set(applied);
    const missing = directories.filter((name) => !appliedSet.has(name));
    value = {
      reachable: true,
      total: directories.length,
      applied: directories.length - missing.length,
      pending: missing.slice(0, 10),
      latest: directories.at(-1) ?? null,
    };
  } catch (error) {
    value = {
      reachable: false,
      total: null,
      applied: null,
      pending: [],
      latest: null,
      error: error instanceof Error ? error.message.slice(0, 200) : 'unknown error',
    };
  }
  cache = { at: Date.now(), value };
  return value;
}
