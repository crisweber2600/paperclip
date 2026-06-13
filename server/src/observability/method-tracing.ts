import {
  SpanKind,
  SpanStatusCode,
  type Span,
  type SpanOptions,
} from "@opentelemetry/api";
import {
  getPaperclipTracer,
  recordSpanError,
  setSpanAttributes,
  type PaperclipSpanAttributes,
} from "./tracing.js";

type AnyFunction = (...args: any[]) => any;
type TraceableObject = Record<PropertyKey, unknown>;

const METHOD_TRACE_WRAPPED = Symbol.for("paperclip.methodTraceWrapped");
const METHOD_TRACE_PROXY_CACHE = new WeakMap<object, object>();

export function traceMethodInvocation<T>(
  name: string,
  attributes: PaperclipSpanAttributes,
  invoke: (span: Span) => T,
  options: SpanOptions = {},
): T {
  return getPaperclipTracer().startActiveSpan(
    name,
    { kind: SpanKind.INTERNAL, ...options },
    (span) => {
      setSpanAttributes(span, attributes);
      let pendingAsyncCompletion = false;

      try {
        const result = invoke(span);
        if (isPromiseLike(result)) {
          pendingAsyncCompletion = true;
          return result.then(
            (value) => {
              span.setStatus({ code: SpanStatusCode.OK });
              span.end();
              return value;
            },
            (err) => {
              recordSpanError(span, err);
              span.end();
              throw err;
            },
          ) as T;
        }

        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        recordSpanError(span, err);
        throw err;
      } finally {
        if (!pendingAsyncCompletion) {
          span.end();
        }
      }
    },
  ) as T;
}

export function instrumentFunction<T extends AnyFunction>(
  namespace: string,
  fn: T,
  attributes: PaperclipSpanAttributes = {},
): T {
  if (isTraceWrapped(fn)) return fn;

  const wrapped = function instrumentedFunction(this: unknown, ...args: Parameters<T>): ReturnType<T> {
    const functionName = fn.name || namespace.split(".").at(-1) || "anonymous";
    return traceMethodInvocation(
      `function ${namespace}`,
      {
        "code.namespace": namespace,
        "code.function": functionName,
        "paperclip.method.namespace": namespace,
        "paperclip.method.name": functionName,
        ...attributes,
      },
      () => Reflect.apply(fn, this, args) as ReturnType<T>,
    );
  } as T;

  markTraceWrapped(wrapped);
  return wrapped;
}

export function instrumentMethods<T extends object>(
  namespace: string,
  target: T,
  attributes: PaperclipSpanAttributes = {},
): T {
  if (isTraceWrapped(target)) return target;

  const cached = METHOD_TRACE_PROXY_CACHE.get(target);
  if (cached) return cached as T;

  const wrappedProperties = new Map<PropertyKey, unknown>();
  const proxy = new Proxy(target as TraceableObject, {
    get(current, property, receiver) {
      if (property === METHOD_TRACE_WRAPPED) return true;

      const value = Reflect.get(current, property, receiver);
      if (typeof value === "function") {
        const existing = wrappedProperties.get(property);
        if (existing) return existing;

        const methodName = String(property);
        const wrapped = function instrumentedMethod(this: unknown, ...args: unknown[]) {
          const thisArg = this === receiver ? current : this;
          return traceMethodInvocation(
            `method ${namespace}.${methodName}`,
            {
              "code.namespace": namespace,
              "code.function": methodName,
              "paperclip.method.namespace": namespace,
              "paperclip.method.name": methodName,
              ...attributes,
            },
            () => Reflect.apply(value, thisArg, args),
          );
        };
        markTraceWrapped(wrapped);
        wrappedProperties.set(property, wrapped);
        return wrapped;
      }

      if (isTraceablePlainObject(value)) {
        const existing = wrappedProperties.get(property);
        if (existing) return existing;

        const wrapped = instrumentMethods(`${namespace}.${String(property)}`, value, attributes);
        wrappedProperties.set(property, wrapped);
        return wrapped;
      }

      return value;
    },
  }) as T;

  METHOD_TRACE_PROXY_CACHE.set(target, proxy);
  return proxy;
}

export function instrumentServiceFactory<TArgs extends unknown[], TResult extends object>(
  namespace: string,
  factory: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  return instrumentFunction(`serviceFactory.${namespace}`, (...args: TArgs) => {
    const service = factory(...args);
    return instrumentMethods(namespace, service, {
      "paperclip.service": namespace,
    });
  });
}

export function instrumentExpressRouterTree(root: unknown, namespace = "paperclip.express"): void {
  const seenContainers = new WeakSet<object>();
  const seenLayers = new WeakSet<object>();

  const visitContainer = (container: unknown, parentPath: string): void => {
    if (!isObject(container) || seenContainers.has(container)) return;
    seenContainers.add(container);

    const stack = readLayerStack(container);
    if (stack) {
      for (const layer of stack) {
        visitLayer(layer, parentPath);
      }
    }

    visitContainer(readObjectProperty(container, "router"), parentPath);
    visitContainer(readObjectProperty(container, "_router"), parentPath);
  };

  const visitLayer = (layer: unknown, parentPath: string): void => {
    if (!isObject(layer) || seenLayers.has(layer)) return;
    seenLayers.add(layer);

    const route = readObjectProperty(layer, "route");
    const routePath = formatExpressPath(readObjectProperty(route, "path") ?? readObjectProperty(layer, "path"));
    const fullPath = joinExpressPaths(parentPath, routePath);
    const routeStack = readLayerStack(route);

    if (routeStack) {
      const methods = readRouteMethods(route);
      for (const routeLayer of routeStack) {
        wrapLayerHandle(routeLayer, {
          namespace,
          kind: "route",
          routePath: fullPath,
          methods,
        });
      }
      return;
    }

    const handle = readObjectProperty(layer, "handle");
    const handleStack = readLayerStack(handle);
    if (handleStack) {
      visitContainer(handle, fullPath);
      return;
    }

    wrapLayerHandle(layer, {
      namespace,
      kind: "middleware",
      routePath: fullPath,
      methods: [],
    });
  };

  visitContainer(root, "");
}

function wrapLayerHandle(layer: unknown, input: {
  namespace: string;
  kind: "middleware" | "route";
  routePath: string;
  methods: string[];
}): void {
  if (!isObject(layer)) return;

  const handle = readObjectProperty(layer, "handle");
  if (typeof handle !== "function" || isTraceWrapped(handle)) return;

  const handlerName = handle.name || String(readObjectProperty(layer, "name") ?? "anonymous");
  const methodLabel = input.methods.length > 0 ? input.methods.join(",") : "MIDDLEWARE";
  const routeLabel = input.routePath || handlerName;
  const spanName = `${input.namespace}.${input.kind} ${methodLabel} ${routeLabel}`;

  const buildAttributes = (req: unknown): PaperclipSpanAttributes => ({
    "paperclip.express.kind": input.kind,
    "paperclip.express.handler": handlerName,
    "http.route": input.routePath || undefined,
    "http.request.method": readRequestString(req, "method"),
    "url.path": readRequestString(req, "path") ?? readRequestString(req, "originalUrl"),
  });

  const wrapped = handle.length >= 4
    ? function instrumentedExpressErrorHandler(this: unknown, err: unknown, req: unknown, res: unknown, next: unknown) {
      return traceMethodInvocation(
        spanName,
        buildAttributes(req),
        () => Reflect.apply(handle, this, [err, req, res, next]),
      );
    }
    : function instrumentedExpressHandler(this: unknown, req: unknown, res: unknown, next: unknown) {
      return traceMethodInvocation(
        spanName,
        buildAttributes(req),
        () => Reflect.apply(handle, this, [req, res, next]),
      );
    };

  markTraceWrapped(wrapped);
  Reflect.set(layer, "handle", wrapped);
}

function readLayerStack(value: unknown): unknown[] | null {
  const stack = readObjectProperty(value, "stack");
  return Array.isArray(stack) ? stack : null;
}

function readRouteMethods(route: unknown): string[] {
  const methods = readObjectProperty(route, "methods");
  if (!isObject(methods)) return [];

  return Object.entries(methods)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([method]) => method.toUpperCase())
    .sort();
}

function formatExpressPath(path: unknown): string {
  if (!path) return "";
  if (typeof path === "string") return path;
  if (path instanceof RegExp) return path.toString();
  if (Array.isArray(path)) return path.map(formatExpressPath).filter(Boolean).join("|");
  return String(path);
}

function joinExpressPaths(parent: string, child: string): string {
  if (!parent) return child;
  if (!child) return parent;
  return `${parent.replace(/\/$/, "")}/${child.replace(/^\//, "")}`;
}

function readRequestString(req: unknown, property: string): string | undefined {
  const value = readObjectProperty(req, property);
  return typeof value === "string" ? value : undefined;
}

function readObjectProperty(value: unknown, property: PropertyKey): unknown {
  return isObject(value) ? Reflect.get(value, property) : undefined;
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

function isTraceablePlainObject(value: unknown): value is TraceableObject {
  if (typeof value !== "object" || value === null || isTraceWrapped(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof Reflect.get(value, "then") === "function"
  );
}

function isTraceWrapped(value: unknown): boolean {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    Boolean(Reflect.get(value, METHOD_TRACE_WRAPPED))
  );
}

function markTraceWrapped<T extends object>(value: T): T {
  Object.defineProperty(value, METHOD_TRACE_WRAPPED, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  return value;
}
