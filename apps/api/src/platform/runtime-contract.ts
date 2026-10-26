// 运行环境契约：把「服务进程以何种形态运行」这件事集中到一处声明。
//
// 为什么要有这一层：
//   原先 server.ts 直接读 process.env，端口写死 default(3001)，DATABASE_URL 只有
//   postgresql:// 一种形态。桌面端（Electron）需要随机端口 + 嵌入式数据库，
//   若继续散落读取，桌面端就会长出第二套硬编码，web 与 desktop 从此分叉。
//
// 本模块只做三件事，不含业务：
//   1. 声明运行形态（standalone / embedded）及其约束
//   2. 校验端口与数据库 URL 的合法性，非法即明确拒绝，绝不静默降级
//   3. 提供「就绪信息」结构，供 renderer / 主进程消费，取代靠日志字符串猜端口
import { z } from 'zod';

/**
 * 运行形态。
 * - standalone：独立部署（当前 web 形态），端口必须显式指定，数据库必须是远程 Postgres。
 * - embedded：嵌入宿主进程（Electron 桌面端），端口允许 0（系统分配），
 *             数据库允许 pglite: 形式（嵌入式实现由数据层负责，本层只做路由与校验）。
 */
export const RUNTIME_MODES = ['standalone', 'embedded'] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

/**
 * 数据库 URL 支持的 scheme。
 *
 * 注意：这里只做**声明与路由**，不实现 pglite 适配器。
 * 未实现的 scheme 必须在校验阶段被拒绝，而不是等到 prisma 初始化时才炸。
 * 这是故意的：静默降级比启动失败危险得多。
 */
export const DB_SCHEMES = ['postgresql', 'postgres', 'pglite'] as const;
export type DbScheme = (typeof DB_SCHEMES)[number];

/** 已实现的 scheme。pglite 在数据层接好之前不在此列。 */
export const IMPLEMENTED_DB_SCHEMES: readonly DbScheme[] = ['postgresql', 'postgres'];

export interface ReadyInfo {
  /** 实际监听的主机地址 */
  host: string;
  /** 实际监听的端口（PORT=0 时这里是系统分配的真实端口） */
  port: number;
  /** 完整 base URL，形如 http://127.0.0.1:38217 */
  baseUrl: string;
  /** 运行形态 */
  mode: RuntimeMode;
  /** 数据库 scheme（不含凭据） */
  databaseScheme: DbScheme;
  /** 应用版本 */
  version: string;
  /** 是否处于公网模式 */
  publicMode: boolean;
}

/** 解析 DATABASE_URL 的 scheme；格式非法时返回 null，由调用方决定如何报错 */
export function parseDbScheme(value: string): DbScheme | null {
  const trimmed = value.trim();
  const separator = trimmed.indexOf(':');
  if (separator <= 0) return null;
  const scheme = trimmed.slice(0, separator).toLowerCase();
  // prisma 也接受 postgres:// 与 postgresql://，pglite 为嵌入式预留
  return (DB_SCHEMES as readonly string[]).includes(scheme) ? (scheme as DbScheme) : null;
}

/**
 * 端口校验。
 *
 * PORT=0 的含义是「由操作系统分配空闲端口」，这是嵌入式形态的标准做法：
 * 避免与用户机器上已有服务抢 3001，也避免多实例冲突。
 *
 * 但 standalone 下 0 是危险的：运维看不到预期端口，反向代理无从配置。
 * 所以按形态分别约束。
 */
export function resolvePortPolicy(mode: RuntimeMode) {
  return z.coerce
    .number()
    .int()
    .min(0)
    .max(65535)
    .refine((port) => mode === 'embedded' || port > 0, {
      message:
        'standalone 形态不接受 PORT=0。随机端口只对 embedded（桌面端）有意义；' +
        '独立部署必须显式指定端口，否则反向代理与运维监控无从配置。',
    });
}

/**
 * 数据库 URL 与运行形态的匹配校验。
 *
 * 规则：
 *   - embedded：允许 postgresql 与 pglite
 *   - standalone：只允许 postgresql（拒绝 pglite，因为独立部署使用嵌入式库
 *     会让「数据库可被 DBA 接管」这一前提失效）
 */
export function validateDatabaseForMode(mode: RuntimeMode, scheme: DbScheme): string | null {
  if (mode === 'embedded') {
    if (!IMPLEMENTED_DB_SCHEMES.includes(scheme) && scheme === 'pglite') {
      return (
        'DATABASE_URL 使用了 pglite: 形式，但当前版本尚未接好嵌入式数据层适配器。\n' +
        '请先完成 PGlite 适配（见 docs/双target一致性检查.md 关联的可行性验证），' +
        '或改用 postgresql:// 指向本地实例。\n' +
        '这里故意直接拒绝，而不是降级为 postgresql —— 静默降级会让嵌入式形态假成功。'
      );
    }
    return null;
  }
  if (scheme === 'pglite') {
    return (
      'standalone 形态不接受 pglite: 数据库。嵌入式库无法被外部 DBA 接管，' +
      '也不符合独立部署的备份与审计前提。请使用 postgresql:// 。'
    );
  }
  return null;
}

/** 环境变量 schema 中与运行形态相关的部分，供 server.ts 合并使用 */
export const runtimeEnvSchema = {
  RUNTIME_MODE: z.enum(RUNTIME_MODES).default('standalone'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3001),
};

/** 从实际监听地址构造就绪信息 */
export function buildReadyInfo(input: {
  host: string;
  port: number;
  mode: RuntimeMode;
  databaseScheme: DbScheme;
  version: string;
  publicMode: boolean;
}): ReadyInfo {
  // IPv6 字面量需要方括号，否则拼出来的 URL 无法解析
  const hostForUrl = input.host.includes(':') && !input.host.startsWith('[') ? `[${input.host}]` : input.host;
  return {
    ...input,
    baseUrl: `http://${hostForUrl}:${input.port}`,
  };
}

/**
 * 就绪握手。
 *
 * 桌面端不能再靠「读取启动日志里的字符串」来发现端口 —— 那是约定，不是协议。
 * 宿主进程启动 API 后，通过本文件（或等价的 IPC）读取这份结构。
 *
 * 写入路径由 MOEHNG_READY_FILE 指定；未指定时不写，保持独立部署行为不变。
 */
export const READY_FILE_ENV = 'MOHENG_READY_FILE';
