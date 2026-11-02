/** PID、属主和启动时间一起标识扫描到的进程 */
export interface ProcessIdentity {
  pid: number;
  uid: number;
  startedAt: string;
}

export interface ServiceInfo {
  port: number;
  pids: number[];
  /** 扫描时的进程身份,关闭前必须与系统再次核对 */
  targets: ProcessIdentity[];
  process: string;
  /** dev = 本地启动的开发服务; app = 第三方 GUI 应用(macOS .app 包内) */
  category: "dev" | "app";
  /** 完整启动命令,用于悬浮提示 */
  command?: string;
  restartable?: boolean;
  /** 关闭成功后签发的服务端记录 ID,不包含命令 */
  restartId?: string;
  /** 无法自动重启时向用户展示的原因 */
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
  sessionToken: string;
  services: ServiceInfo[];
  scanned: number;
  checkedAt: string;
}

export interface CloseResult {
  closed: boolean;
  forced: boolean;
  pids: number[];
  message: string;
  restartId?: string;
  noRestartReason?: string;
}
