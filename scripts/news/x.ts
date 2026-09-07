import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { NewsCatalog } from "../../lib/news/types.ts";
import { xCredentials, xRequest, XRequestError } from "../../lib/news/x-client.ts";
import { xNewsArticle, xNewsCoverUrl, xNewsPayload, verifyXPhotoPost, X_NEWS_ACCOUNT } from "../../lib/news/x-publication.ts";
import { hourlyPublicationDue } from "../../lib/news/hourly-publication.ts";
import { xUploadNewsCover } from "../../lib/news/x-media.ts";

const directory = process.env.ODDSFRONT_NEWS_DIRECTORY || "/root/OddsFront/.local/news";
const output = path.join(directory, "x");
await mkdir(output, { recursive: true, mode: 0o700 });
if (!process.env.ODDSFRONT_X_LOCKED) {
  const run = spawnSync("flock", ["-n", path.join(output, "publish.lock"), process.execPath, ...process.execArgv, ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, ODDSFRONT_X_LOCKED: "1" } });
  process.exit(run.status ?? 1);
}
interface State { lastSentAt: number; sentArticles: string[]; pending?: { articleId: string; attemptedAt: string }; }
async function atomic(file: string, value: unknown) {
  await writeFile(`${file}.${process.pid}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(`${file}.${process.pid}.tmp`, file);
}
const stateFile = path.join(output, "state.json");
try {
  let state: State = { lastSentAt: 0, sentArticles: [] };
  try { state = JSON.parse(await readFile(stateFile, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (state.pending) throw new Error("Previous X send has an unknown outcome; reconcile before retrying");
  if (!process.argv.includes("--force") && !hourlyPublicationDue(state.lastSentAt)) { console.log(JSON.stringify({ status: "interval-not-due" })); process.exit(0); }
  const catalog = JSON.parse(await readFile(path.join(directory, "catalog.json"), "utf8")) as NewsCatalog;
  let telegram: { sentArticles: string[] } = { sentArticles: [] };
  try { telegram = JSON.parse(await readFile(path.join(directory, "telegram/state.json"), "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const article = xNewsArticle(catalog.articles, telegram.sentArticles, state.sentArticles);
  if (!article) { console.log(JSON.stringify({ status: "waiting-for-fresh-edition-selection" })); process.exit(0); }
  const headline = xNewsPayload(article);
  const coverUrl = xNewsCoverUrl(article);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await atomic(path.join(output, `${stamp}-draft.json`), { account: X_NEWS_ACCOUNT, articleId: article.id, payload: headline, coverUrl });
  if (!process.argv.includes("--send")) { console.log(JSON.stringify({ status: "draft", account: X_NEWS_ACCOUNT, payload: headline, coverUrl })); process.exit(0); }
  const credentialFile = process.env.ODDSFRONT_X_CREDENTIAL_ENV || "/root/OddsFront/.local/x-auth/credentials.env";
  const credentials = await xCredentials(credentialFile);
  const identity = await xRequest(credentials, "GET", "/2/users/me");
  if (identity.data?.username?.toLowerCase() !== X_NEWS_ACCOUNT || !identity.data?.id) throw new Error("X credentials do not belong to @alotofbit");
  const media = await xUploadNewsCover(credentials, article);
  const payload = { ...headline, media: { media_ids: [media.mediaId] } };
  await atomic(path.join(output, `${stamp}-draft.json`), { account: X_NEWS_ACCOUNT, articleId: article.id, payload, cover: media });
  await atomic(stateFile, { ...state, pending: { articleId: article.id, attemptedAt: new Date().toISOString() } });
  let created;
  try { created = await xRequest(credentials, "POST", "/2/tweets", payload); }
  catch(error) {
    if(error instanceof XRequestError && error.definiteRejection) await atomic(stateFile,state);
    throw error;
  }
  const postId = created.data?.id;
  if (!postId || !/^\d+$/.test(postId)) throw new Error("Unexpected X publication receipt");
  const receipt = { status: "published", account: X_NEWS_ACCOUNT, accountId: identity.data.id, articleId: article.id, postId, url: `https://x.com/${X_NEWS_ACCOUNT}/status/${postId}`, sentAt: new Date().toISOString(), payload, cover: media };
  await atomic(path.join(output, `${stamp}-receipt.json`), receipt);
  await atomic(stateFile, { lastSentAt: Date.now(), sentArticles: [...state.sentArticles, article.id].slice(-1_000) });
  const verified = await xRequest(credentials, "GET", `/2/tweets/${postId}?tweet.fields=author_id,entities,attachments&expansions=attachments.media_keys&media.fields=type,url`);
  verifyXPhotoPost(verified, { postId, accountId: identity.data.id, text: headline.text, mediaKey: media.mediaKey });
  await atomic(path.join(output, `${stamp}-verification.json`), { postId, accountId: verified.data.author_id, mediaKey: media.mediaKey, noExternalLinks: true, verifiedAt: new Date().toISOString() });
  console.log(JSON.stringify({ ...receipt, verified: true }));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "X publication failed" }));
  process.exitCode = 1;
}
