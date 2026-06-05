import { Writable } from "node:stream";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import type { AnyValue, AnyValueMap, Logger as OpenTelemetryLogger } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { defaultResource, detectResources, envDetector, resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

type PinoLogRecord = Record<string, unknown> & {
  level?: unknown;
  time?: unknown;
  msg?: unknown;
  message?: unknown;
  err?: unknown;
};

let provider: LoggerProvider | undefined;
let otelLogger: OpenTelemetryLogger | undefined;
let shutDown = false;

export function createOpenTelemetryLogStream(): Writable | undefined {
  if (!isOpenTelemetryLogsEnabled()) return undefined;

  initializeOpenTelemetryLogs();

  let buffered = "";

  return new Writable({
    write(chunk, _encoding, callback) {
      buffered += chunk.toString("utf8");

      let newlineIndex = buffered.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffered.slice(0, newlineIndex).trim();
        buffered = buffered.slice(newlineIndex + 1);
        if (line) emitPinoLine(line);
        newlineIndex = buffered.indexOf("\n");
      }

      callback();
    },
    final(callback) {
      const line = buffered.trim();
      buffered = "";
      if (line) emitPinoLine(line);
      callback();
    },
  });
}

export async function shutdownOpenTelemetryLogs(): Promise<void> {
  if (!provider || shutDown) return;
  shutDown = true;
  await provider.shutdown();
}

function isOpenTelemetryLogsEnabled(): boolean {
  if (process.env.OTEL_SDK_DISABLED?.toLowerCase() === "true") return false;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint?.trim()) return false;

  const protocol = process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL ?? process.env.OTEL_EXPORTER_OTLP_PROTOCOL;
  return !protocol || protocol === "http/protobuf";
}

function initializeOpenTelemetryLogs(): void {
  if (provider) return;

  const exporter = new OTLPLogExporter();
  const resource = defaultResource()
    .merge(detectResources({ detectors: [envDetector] }))
    .merge(resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME?.trim() || "paperclip-server",
    }));

  provider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor(exporter, {
        scheduledDelayMillis: readPositiveIntegerEnv("OTEL_BLRP_SCHEDULE_DELAY", 1000),
        exportTimeoutMillis: readPositiveIntegerEnv("OTEL_BLRP_EXPORT_TIMEOUT", 30000),
        maxExportBatchSize: readPositiveIntegerEnv("OTEL_BLRP_MAX_EXPORT_BATCH_SIZE", 512),
        maxQueueSize: readPositiveIntegerEnv("OTEL_BLRP_MAX_QUEUE_SIZE", 2048),
      }),
    ],
  });

  logs.setGlobalLoggerProvider(provider);
  otelLogger = logs.getLogger("paperclip.pino");
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function emitPinoLine(line: string): void {
  if (!otelLogger || shutDown) return;

  try {
    emitPinoRecord(JSON.parse(line) as PinoLogRecord);
  } catch {
    otelLogger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      body: line,
    });
  }
}

function emitPinoRecord(record: PinoLogRecord): void {
  const severity = pinoSeverity(record.level);
  const timestamp = typeof record.time === "number" ? new Date(record.time) : undefined;
  const body = stringifyLogBody(record.msg ?? record.message ?? record);
  const attributes = recordAttributes(record);
  const exception = normalizeException(record.err);

  otelLogger?.emit({
    timestamp,
    severityNumber: severity.number,
    severityText: severity.text,
    body,
    attributes,
    ...(exception ? { exception } : {}),
  });
}

function pinoSeverity(level: unknown): { number: SeverityNumber; text: string } {
  const numericLevel = typeof level === "number" ? level : Number.parseInt(String(level ?? ""), 10);

  if (numericLevel >= 60) return { number: SeverityNumber.FATAL, text: "FATAL" };
  if (numericLevel >= 50) return { number: SeverityNumber.ERROR, text: "ERROR" };
  if (numericLevel >= 40) return { number: SeverityNumber.WARN, text: "WARN" };
  if (numericLevel >= 30) return { number: SeverityNumber.INFO, text: "INFO" };
  if (numericLevel >= 20) return { number: SeverityNumber.DEBUG, text: "DEBUG" };
  if (numericLevel >= 10) return { number: SeverityNumber.TRACE, text: "TRACE" };

  return { number: SeverityNumber.UNSPECIFIED, text: "UNSPECIFIED" };
}

function stringifyLogBody(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function recordAttributes(record: PinoLogRecord): AnyValueMap {
  const attributes: AnyValueMap = {};
  const skipped = new Set(["level", "time", "msg", "message", "err"]);

  for (const [key, value] of Object.entries(record)) {
    if (skipped.has(key) || value === undefined) continue;
    attributes[`log.${key}`] = normalizeAttributeValue(value);
  }

  if (typeof record.level === "number") attributes["log.pino.level"] = record.level;

  const err = normalizeException(record.err);
  if (err) {
    if (err.type) attributes["exception.type"] = err.type;
    if (err.message) attributes["exception.message"] = err.message;
    if (err.stack) attributes["exception.stacktrace"] = err.stack;
  }

  return attributes;
}

function normalizeException(value: unknown): { type?: string; message?: string; stack?: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const err = value as Record<string, unknown>;
  return {
    type: typeof err.type === "string" ? err.type : typeof err.name === "string" ? err.name : undefined,
    message: typeof err.message === "string" ? err.message : undefined,
    stack: typeof err.stack === "string" ? err.stack : undefined,
  };
}

function normalizeAttributeValue(value: unknown, depth = 0): AnyValue {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (depth >= 4) return stringifyLogBody(value);

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeAttributeValue(entry, depth + 1));
  }

  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    const normalized: AnyValueMap = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) normalized[key] = normalizeAttributeValue(entry, depth + 1);
    }
    return normalized;
  }

  return String(value);
}
