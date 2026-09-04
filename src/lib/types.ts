/** 重启配方:服务关闭前从系统捕获的启动信息 */
export type RestartRecipe =
  | { kind: "argv"; cwd?: string; argv: string[] }
  | { kind: "script"; cwd: string; command: string }
  | { kind: "app"; appPath: string };

export interface ServiceInfo {
  port: number;
  pids: number[];
  process: string;
  /** dev = 本地启动的开发服务; app = 第三方 GUI 应用(macOS .app 包内) */
  category: "dev" | "app";
  /** 完整启动命令,用于悬浮提示 */
  command?: string;
  /** 可恢复的重启配方,缺失表示无法自动重启 */
  restart?: RestartRecipe;
  /** 无法自动重启的原因(中文说明),仅 restart 缺失时存在 */
  noRestartReason?: string;
  /** 人类可读的服务标题(项目名 / 网页标题 / 应用名) */
  title?: string;
  /** 标题来源,用于悬浮提示 */
  titleSource?: "package" | "html" | "app" | "process";
  httpCode?: number;
  latencyMs?: number;
  checkedAt: string;
}

export interface ServicesPayload {
  services: ServiceInfo[];
  scanned: number;
  checkedAt: string;
}

export interface CloseResult {
  closed: boolean;
  forced: boolean;
  pids: number[];
  message: string;
}
