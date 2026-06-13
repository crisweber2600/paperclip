import { SpanStatusCode, trace, type Span, type SpanOptions } from "@opentelemetry/api";

type PrimitiveSpanAttribute = string | number | boolean;
export type PaperclipSpanAttributes = Record<
  string,
  PrimitiveSpanAttribute | null | undefined
>;

const tracer = trace.getTracer("paperclip-server");

export function getPaperclipTracer() {
  return tracer;
}

export async function withPaperclipSpan<T>(
  name: string,
  attributes: PaperclipSpanAttributes,
  fn: (span: Span) => Promise<T>,
  options?: SpanOptions,
): Promise<T> {
  return tracer.startActiveSpan(name, options ?? {}, async (span) => {
    setSpanAttributes(span, attributes);
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      recordSpanError(span, err);
      throw err;
    } finally {
      span.end();
    }
  });
}

export function setSpanAttributes(span: Span, attributes: PaperclipSpanAttributes): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) continue;
    span.setAttribute(key, value);
  }
}

export function recordSpanError(span: Span, err: unknown): void {
  span.recordException(err instanceof Error ? err : new Error(String(err)));
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: err instanceof Error ? err.message : String(err),
  });
}
