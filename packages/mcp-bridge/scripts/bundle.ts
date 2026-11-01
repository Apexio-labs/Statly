/** Packs the bridge into the file a person opens in Claude Desktop. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aiTools } from "@statly/contract";
import { zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, "../../../addon/src/statly/modules/ai/statly.mcpb");

const manifest = {
  manifest_version: "0.3",
  name: "statly",
  display_name: "Statly",
  version: "1.0.0",
  description: "Ask about your Anki statistics and let the AI suggest dashboard changes.",
  author: { name: "The Statly Contributors" },
  license: "SEE LICENSE",
  server: {
    type: "node",
    entry_point: "server/index.mjs",
    mcp_config: {
      command: "node",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the AI app fills this in.
      args: ["${__dirname}/server/index.mjs"],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the AI app fills this in.
      env: { STATLY_CODE: "${user_config.connection_code}" },
    },
  },
  user_config: {
    connection_code: {
      type: "string",
      title: "Connection code",
      description: "Create it in Statly under AI settings, Advanced, Allow external AI apps.",
      sensitive: true,
      required: true,
    },
  },
  tools: Object.entries(aiTools).map(([name, tool]) => ({
    name,
    description: tool.description.split(". ")[0],
  })),
  tools_generated: false,
  compatibility: { runtimes: { node: ">=20.0.0" } },
};

const encoder = new TextEncoder();
const bundle = zipSync({
  "manifest.json": encoder.encode(JSON.stringify(manifest, null, 2)),
  "server/index.mjs": readFileSync(resolve(here, "../dist/index.mjs")),
  "icon.png": readFileSync(resolve(here, "../../ui/assets/Statly_Logo_Icon.png")),
  LICENSE: readFileSync(resolve(here, "../../../LICENSE")),
  "THIRD_PARTY_NOTICES.txt": readFileSync(resolve(here, "../dist/THIRD_PARTY_NOTICES.txt")),
});

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, bundle);
console.log(`${output} (${Math.round(bundle.length / 1024)} KB)`);
