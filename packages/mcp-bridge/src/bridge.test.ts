import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readCode } from "./statly.ts";

const TOKEN = "a-long-enough-test-token-1234";
const entry = resolve(import.meta.dirname, "../dist/index.mjs");

const TOOLS = [
  {
    name: "get_today",
    description: "Today",
    inputSchema: { type: "object", properties: {} },
  },
];

let statly: Server;
let port = 0;
const seen: { url: string; authorization: string | undefined; body: string }[] = [];

function answer(request: IncomingMessage, response: ServerResponse) {
  let body = "";
  request.on("data", (part) => {
    body += part;
  });
  request.on("end", () => {
    seen.push({ url: request.url ?? "", authorization: request.headers.authorization, body });
    const payload =
      request.url === "/v1/tools"
        ? { tools: TOOLS }
        : { result: { result: { date: "2026-11-01" } }, failed: false };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
}

async function connect(code: string): Promise<Client> {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StdioClientTransport({ command: "node", args: [entry], env: { STATLY_CODE: code } }),
  );
  return client;
}

beforeAll(async () => {
  execFileSync("pnpm", ["exec", "vite", "build"], {
    cwd: resolve(import.meta.dirname, ".."),
    stdio: "ignore",
  });
  statly = createServer(answer);
  await new Promise<void>((done) => statly.listen(0, "127.0.0.1", done));
  port = (statly.address() as AddressInfo).port;
});

afterAll(() => statly.close());

describe("connection codes", () => {
  it("reads a code", () => {
    expect(readCode(`statly1.1234.${TOKEN}`)).toEqual({ port: 1234, token: TOKEN });
  });

  it.each(["", "statly1.abc.token", "other.1234.x", undefined])("refuses %s", (code) => {
    expect(() => readCode(code)).toThrow("connection code");
  });
});

describe("the bridge", () => {
  it("lists Statly's tools and calls them with the code", async () => {
    const client = await connect(`statly1.${port}.${TOKEN}`);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["get_today"]);

    const result = await client.callTool({ name: "get_today", arguments: {} });
    expect(result.isError).toBe(false);
    expect(JSON.stringify(result.content)).toContain("2026-11-01");
    expect(seen.at(-1)).toMatchObject({
      url: "/v1/tools/get_today",
      authorization: `Bearer ${TOKEN}`,
      body: "{}",
    });
    await client.close();
  });

  it("explains when Anki is closed", async () => {
    const client = await connect(`statly1.59999.${TOKEN}`);
    const result = await client.callTool({ name: "get_today", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("open Anki");
    await client.close();
  });
});
