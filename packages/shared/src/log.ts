// 极简结构化日志：单行 JSON 输出到 stdout/stderr，方便容器日志采集与 grep。
// 不引入 pino/winston 等外部依赖——worker/media 没有 Fastify，自建 30 行够用。
// API 已用 Fastify 内置 pino，不消费本模块；本模块只服务 worker + media。
//
// 输出格式：
//   {"t":"2026-06-30T12:34:56.789Z","level":"info","component":"worker","msg":"scan run complete","runId":"scan_xxx"}
//
// 级别通过 HILI_LOG_LEVEL 环境变量控制（debug/info/warn/error），默认 info。

type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function minLevel(): LogLevel {
  const raw = process.env.HILI_LOG_LEVEL;
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

const MIN_LEVEL = minLevel();

function emit(level: LogLevel, component: string, message: string, fields?: LogFields): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[MIN_LEVEL]) {
    return;
  }
  const payload: LogFields = {
    t: new Date().toISOString(),
    level,
    component,
    msg: message
  };
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        payload[key] = value;
      }
    }
  }
  const line = JSON.stringify(payload);
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else if (level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export type Logger = {
  debug: (message: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields) => void;
};

export function createLogger(component: string): Logger {
  return {
    debug: (message, fields) => emit("debug", component, message, fields),
    info: (message, fields) => emit("info", component, message, fields),
    warn: (message, fields) => emit("warn", component, message, fields),
    error: (message, fields) => emit("error", component, message, fields)
  };
}
