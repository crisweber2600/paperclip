import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  instrumentExpressRouterTree,
  instrumentFunction,
  instrumentMethods,
  instrumentServiceFactory,
} from "../observability/method-tracing.js";

describe("method tracing wrappers", () => {
  it("preserves synchronous method returns and this binding", () => {
    const service = instrumentMethods("testService", {
      value: 4,
      add(input: number) {
        return this.value + input;
      },
    });

    expect(service.add(6)).toBe(10);
  });

  it("preserves asynchronous method rejections", async () => {
    const service = instrumentMethods("testService", {
      async fail() {
        throw new Error("expected failure");
      },
    });

    await expect(service.fail()).rejects.toThrow("expected failure");
  });

  it("wraps service factory results idempotently", () => {
    const createService = instrumentServiceFactory("factoryService", () => ({
      list() {
        return ["ok"];
      },
    }));

    const service = createService();
    expect(service.list()).toEqual(["ok"]);
    expect(instrumentMethods("factoryService", service)).toBe(service);
  });

  it("wraps standalone functions without changing return values", () => {
    const join = instrumentFunction("test.join", (left: string, right: string) => `${left}:${right}`);

    expect(join("a", "b")).toBe("a:b");
  });

  it("preserves Express route and error handler behavior", async () => {
    const app = express();
    app.get("/ok", (_req, res) => {
      res.status(200).json({ ok: true });
    });
    app.get("/boom", () => {
      throw new Error("boom");
    });
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ message: err.message });
    });

    instrumentExpressRouterTree(app);

    await request(app).get("/ok").expect(200, { ok: true });
    await request(app).get("/boom").expect(500, { message: "boom" });
  });
});
