import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { callTool, listTools, readCode } from "./statly.ts";

const server = new Server({ name: "statly", version: "1.0.0" }, { capabilities: { tools: {} } });

// A wrong code should reach the person through their AI app, not end the process silently.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: await listTools(readCode(process.env.STATLY_CODE)),
}));

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const answer = await callTool(readCode(process.env.STATLY_CODE), params.name, params.arguments);
    return {
      content: [{ type: "text", text: JSON.stringify(answer.result) }],
      isError: answer.failed,
    };
  } catch (error) {
    return { content: [{ type: "text", text: (error as Error).message }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
