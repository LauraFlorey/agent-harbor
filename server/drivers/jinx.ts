import type { ProviderDriver } from "../contracts.ts";
import { createOpenRouterDriver } from "./openrouter.ts";
import { decodeJinxConnection, jinxJson, jinxRequest, type JinxConnection } from "../jinx-connection.ts";

export const JinxDriver: ProviderDriver<JinxConnection> = {
  driverKind: "jinx",
  metadata: { displayName: "Jinx on Mac Mini", supportsMultipleInstances: false },
  models: { default: "jinx", options: [{ id: "jinx", label: "Jinx on Mac Mini" }] },
  defaultConfig: () => ({ host: "", root: "" }),
  decodeConfig: decodeJinxConnection,
  async create(input) {
    const config = decodeJinxConnection(input.config);
    const transport: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname.replace(/^\/api\/v1/, "");
      return jinxRequest(config, path, init?.body ? JSON.parse(String(init.body)) : undefined, init?.signal ?? undefined);
    };
    const driver = createOpenRouterDriver(transport, false, {
      kind: "jinx", displayName: "Jinx on Mac Mini",
      afterTurn: async (turn, turnId, text, signal) => {
        await jinxJson(config, "/archive", { turnId, user: turn.text, assistant: text }, signal);
      },
    });
    const instance = await driver.create({ ...input, environment: {}, config: driver.defaultConfig() });
    instance.models.default = "jinx";
    instance.models.options.splice(0, instance.models.options.length, { id: "jinx", label: "Jinx on Mac Mini" });
    instance.snapshot = async () => {
      try {
        await jinxJson(config, "/status", undefined, AbortSignal.timeout(10_000));
        return { state: "available", authenticated: true, version: null };
      } catch {
        return { state: "unavailable", reason: "Jinx is unavailable. Check the Mac Mini and its Jinx service." };
      }
    };
    return instance;
  },
};
