// 清空登录限流桶（仅清运行时状态，不改任何安全配置）
// 用途：E2E/视觉回归连续登录会触发 12 次/15 分钟的限制
import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';

const before = await prisma.loginAttemptBucket.findMany({
  select: { keyHash: true, failures: true, blockedUntil: true },
});
console.log('before:', JSON.stringify(before, null, 2));

const deleted = await prisma.loginAttemptBucket.deleteMany({});
console.log('deleted buckets:', deleted.count);
console.log('remaining:', await prisma.loginAttemptBucket.count());

await prisma.$disconnect();
