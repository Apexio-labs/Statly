/** Vite plugin that collects the licenses of everything that really ended up in a bundle. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

const LICENSE_FILE = /^(licen[cs]e|copying|notice)/i;
const PACKAGE_NAME = /^(?:@[^/]+\/)?[^/]+/;
const MARKER = "/node_modules/";

function packageRootOf(moduleId: string): string | null {
  const plain = moduleId.replace(/^\0/, "").split("?")[0] ?? "";
  // pnpm nests folders, so the innermost node_modules names the package.
  const start = plain.lastIndexOf(MARKER);
  const name = start < 0 ? null : PACKAGE_NAME.exec(plain.slice(start + MARKER.length))?.[0];
  return name ? plain.slice(0, start + MARKER.length) + name : null;
}

function noticeFor(root: string): { name: string; text: string } {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
  if (!manifest.license) {
    throw new Error(`${manifest.name} states no license, so it cannot be shipped.`);
  }
  const files = readdirSync(root, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && LICENSE_FILE.test(entry.name),
  );
  const texts = files.map((file) => readFileSync(join(root, file.name), "utf-8").trim());
  const author = manifest.author?.name ?? manifest.author;
  // Some packages only state their license in package.json, so that is all there is to pass on.
  const body = texts.length ? texts : [`Licensed as stated by the package. Author: ${author}`];
  const heading = `${manifest.name} ${manifest.version} (${manifest.license})`;
  return { name: manifest.name, text: `${heading}\n\n${body.join("\n\n")}` };
}

export function licenseNotices(): Plugin {
  return {
    name: "statly-license-notices",
    apply: "build",
    generateBundle(_options, bundle) {
      const roots = new Set<string>();
      for (const item of Object.values(bundle)) {
        if (item.type === "chunk") {
          for (const id of Object.keys(item.modules)) {
            const root = packageRootOf(id);
            if (root && existsSync(join(root, "package.json"))) {
              roots.add(root);
            }
          }
        }
      }
      const notices = [...roots].map(noticeFor).sort((a, b) => a.name.localeCompare(b.name));
      this.emitFile({
        type: "asset",
        fileName: "THIRD_PARTY_NOTICES.txt",
        source: `${notices.map((notice) => notice.text).join(`\n\n${"-".repeat(72)}\n\n`)}\n`,
      });
    },
  };
}
