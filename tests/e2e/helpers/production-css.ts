import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Next can emit CSS under static/css (Webpack) or static/chunks (Turbopack). */
export async function productionCss() {
  const root = path.join(process.cwd(), ".next/static");
  const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith(".css")).sort();
  if (!files.length) throw new Error("Production CSS missing: run the production build before visual tests.");
  return (await Promise.all(files.map(file => readFile(path.join(root, file), "utf8")))).join("\n");
}
