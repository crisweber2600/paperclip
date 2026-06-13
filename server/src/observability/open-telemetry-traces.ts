import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { defaultResource, detectResources, envDetector, resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

let provider: NodeTracerProvider | undefined;
let shutDown = false;

export function initializeOpenTelemetryTraces(): void {
  if (!isOpenTelemetryTracesEnabled() || provider) return;

  if (process.env.OTEL_DIAGNOSTIC_LOG_LEVEL) {
    diag.setLogger(new DiagConsoleLogger(), parseDiagLogLevel(process.env.OTEL_DIAGNOSTIC_LOG_LEVEL));
  }

  const exporter = new OTLPTraceExporter();
  const resource = defaultResource()
    .merge(detectResources({ detectors: [envDetector] }))
    .merge(resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME?.trim() || "paperclip-server",
    }));

  provider = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(exporter, {
        scheduledDelayMillis: readPositiveIntegerEnv("OTEL_BSP_SCHEDULE_DELAY", 1000),
        exportTimeoutMillis: readPositiveIntegerEnv("OTEL_BSP_EXPORT_TIMEOUT", 30000),
        maxExportBatchSize: readPositiveIntegerEnv("OTEL_BSP_MAX_EXPORT_BATCH_SIZE", 512),
        maxQueueSize: readPositiveIntegerEnv("OTEL_BSP_MAX_QUEUE_SIZE", 2048),
      }),
    ],
  });

  provider.register();

  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => {
          const url = req.url ?? "";
          return url === "/api/health" || url.startsWith("/@vite") || url.startsWith("/node_modules/");
        },
      }),
      new ExpressInstrumentation(),
    ],
  });
}

export async function shutdownOpenTelemetryTraces(): Promise<void> {
  if (!provider || shutDown) return;
  shutDown = true;
  await provider.shutdown();
}

function isOpenTelemetryTracesEnabled(): boolean {
  if (process.env.OTEL_SDK_DISABLED?.toLowerCase() === "true") return false;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint?.trim()) return false;

  const protocol = process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? process.env.OTEL_EXPORTER_OTLP_PROTOCOL;
  return !protocol || protocol === "http/protobuf";
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseDiagLogLevel(value: string): DiagLogLevel {
  switch (value.trim().toLowerCase()) {
    case "all":
      return DiagLogLevel.ALL;
    case "verbose":
      return DiagLogLevel.VERBOSE;
    case "debug":
      return DiagLogLevel.DEBUG;
    case "info":
      return DiagLogLevel.INFO;
    case "warn":
      return DiagLogLevel.WARN;
    case "error":
      return DiagLogLevel.ERROR;
    case "none":
      return DiagLogLevel.NONE;
    default:
      return DiagLogLevel.INFO;
  }
}

initializeOpenTelemetryTraces();
