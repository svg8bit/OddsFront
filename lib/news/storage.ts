import { mkdir, rename, writeFile, chmod, rm } from "node:fs/promises";
import path from "node:path";
import { newsIndex } from "./publication.ts";
import type { NewsArticle, NewsCatalog } from "./types.ts";

export async function writeNewsCatalog(directory: string, publicDirectory: string, catalog: NewsCatalog, articles: NewsArticle[]) {
  const details = path.join(publicDirectory, "articles");
  await mkdir(details, { recursive: true });
  await chmod(publicDirectory, 0o755);
  await chmod(details, 0o755);
  for (const article of articles) {
    if (article.withdrawal) continue;
    const file = path.join(details, `${article.slug}.json`);
    await writeFile(`${file}.tmp`, JSON.stringify(article), { mode: 0o644 });
    await chmod(`${file}.tmp`, 0o644);
    await rename(`${file}.tmp`, file);
  }
  // Detail files exist before either catalog points to them. The edition's
  // persisted pending record makes a partially failed export retryable.
  const privateFile = path.join(directory, "catalog.json");
  await writeFile(`${privateFile}.tmp`, JSON.stringify(catalog), { mode: 0o600 });
  await rename(`${privateFile}.tmp`, privateFile);
  const index = path.join(publicDirectory, "catalog.json");
  await writeFile(`${index}.tmp`, JSON.stringify({ ...catalog, ...newsIndex(catalog) }), { mode: 0o644 });
  await chmod(`${index}.tmp`, 0o644);
  await rename(`${index}.tmp`, index);
  for (const article of catalog.articles.filter(article => article.withdrawal)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)) throw new Error("Invalid withdrawn article slug");
    await rm(path.join(details, `${article.slug}.json`), { force: true });
  }
}
