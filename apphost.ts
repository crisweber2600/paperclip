import { createBuilder } from "./.modules/aspire.js";

const builder = await createBuilder();

const otlpHttpEndpoint = process.env.ASPIRE_DASHBOARD_OTLP_HTTP_ENDPOINT_URL;

let paperclip = await builder.addJavaScriptApp("paperclip", ".", { runScriptName: "dev:server" });
paperclip = await paperclip.withPnpm({ install: false });
paperclip = await paperclip.withHttpEndpoint({ env: "PORT" });
paperclip = await paperclip.withExternalHttpEndpoints();
paperclip = await paperclip.withEnvironment("HOST", "127.0.0.1");
paperclip = await paperclip.withEnvironment("PAPERCLIP_BIND", "loopback");
paperclip = await paperclip.withEnvironment("PAPERCLIP_DEPLOYMENT_MODE", "local_trusted");
paperclip = await paperclip.withEnvironment("PAPERCLIP_DEPLOYMENT_EXPOSURE", "private");
paperclip = await paperclip.withEnvironment("PAPERCLIP_AUTH_BASE_URL_MODE", "auto");
paperclip = await paperclip.withEnvironment("PAPERCLIP_AUTH_PUBLIC_BASE_URL", "");
paperclip = await paperclip.withEnvironment("PAPERCLIP_MIGRATION_AUTO_APPLY", "true");
paperclip = await paperclip.withEnvironment("PAPERCLIP_MIGRATION_PROMPT", "never");
paperclip = await paperclip.withEnvironment("PAPERCLIP_UI_DEV_MIDDLEWARE", "true");
paperclip = await paperclip.withEnvironment("OTEL_SERVICE_NAME", "paperclip-server");

if (otlpHttpEndpoint) {
  paperclip = await paperclip.withEnvironment("OTEL_EXPORTER_OTLP_ENDPOINT", otlpHttpEndpoint);
  paperclip = await paperclip.withEnvironment("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf");
  paperclip = await paperclip.withEnvironment("OTEL_BLRP_SCHEDULE_DELAY", "1000");
}

const app = await builder.build();
await app.run();
