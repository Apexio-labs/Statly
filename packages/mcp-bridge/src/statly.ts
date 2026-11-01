/** Talks to the local connection inside Anki. Nothing here leaves this computer. */

export type StatlyTool = { name: string; description: string; inputSchema: object };

export type Connection = { port: number; token: string };

const CODE = /^statly1\.(\d{2,5})\.([A-Za-z0-9_-]{20,})$/;
const NOT_RUNNING =
  "Statly is not reachable. Please open Anki and turn on external AI apps in Statly.";
const BAD_CODE = "The connection code is not valid. Create a new one in Statly and enter it here.";

export function readCode(code: string | undefined): Connection {
  const match = CODE.exec((code ?? "").trim());
  if (!match?.[1] || !match[2]) {
    throw new Error(BAD_CODE);
  }
  return { port: Number(match[1]), token: match[2] };
}

async function request(connection: Connection, path: string, body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${connection.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(35_000),
    });
  } catch {
    throw new Error(NOT_RUNNING);
  }
  if (response.status === 401) {
    throw new Error(BAD_CODE);
  }
  if (!response.ok) {
    throw new Error(NOT_RUNNING);
  }
  return response.json();
}

export async function listTools(connection: Connection): Promise<StatlyTool[]> {
  const { tools } = (await request(connection, "/v1/tools")) as { tools: StatlyTool[] };
  return tools;
}

export async function callTool(
  connection: Connection,
  name: string,
  input: unknown,
): Promise<{ result: unknown; failed: boolean }> {
  const path = `/v1/tools/${encodeURIComponent(name)}`;
  return (await request(connection, path, input ?? {})) as { result: unknown; failed: boolean };
}
