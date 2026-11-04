import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error('DATABASE_URL is required to initialize the PostgreSQL Prisma adapter');
}

/**
 * 2026-11-04：会话时区固定为 UTC。
 *
 * 这台机器的 PostgreSQL 跑在 `TimeZone = Asia/Shanghai` 下，实测落地值会偏 8 小时：
 * Node 写入 `2026-11-04T11:28:29.070Z`，库里存成 `2026-11-04 11:28:29.07+08`，
 * 真正的时间点是 03:28:29Z。Prisma 读回来又是 11:28Z，所以应用内部看着自洽，
 * 但任何和 `NOW()` 比较的地方都错 8 小时：助手孤儿任务回收会把刚创建的运行判成过期，
 * 每用户每分钟 6 次、近 30 天用量窗口也跟着偏。
 *
 * CI 的 postgres 容器是 UTC，所以这套问题只在本地或任何非 UTC 实例上出现，
 * 隔离库跑 `test:assistant-recovery:postgres` 时暴露出来（S1/S2 刚建成即被判为孤儿）。
 * 代码里没有任何依赖会话时区的 `date_trunc` / `CURRENT_DATE` / `::date` SQL，
 * 把会话钉在 UTC 只影响落库时的解释，不改业务口径。
 */
const adapter = new PrismaPg({ connectionString, options: '-c timezone=UTC' });
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
