import { expect, test } from "@playwright/test";
import { mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { xCredentials, xRequest } from "../lib/news/x-client";

const fixture = (expiresAt: number) => `X_OAUTH2_CLIENT_ID=development-client\nX_OAUTH2_CLIENT_SECRET=development-secret\nX_OAUTH2_ACCESS_TOKEN=development-access\nX_OAUTH2_REFRESH_TOKEN=development-refresh\nX_OAUTH2_EXPIRES_AT=${expiresAt}\n`;

test("X uses a current OAuth2 connection without refreshing it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "oddsfront-development-x-"));
  const file = path.join(directory, "x.env");
  const originalFetch = globalThis.fetch;
  try {
    await writeFile(file, fixture(Date.now() + 3_600_000), { mode: 0o600 });
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      calls.push(String(input));
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer development-access");
      return Response.json({ data: { id: "development-user" } });
    };
    expect((await xRequest(await xCredentials(file), "GET", "/2/users/me")).data.id).toBe("development-user");
    expect(calls).toEqual(["https://api.x.com/2/users/me"]);
  } finally { globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); }
});

test("X refreshes an expired connection and persists rotated tokens privately for the next run", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "oddsfront-development-x-"));
  const file = path.join(directory, "x.env");
  const originalFetch = globalThis.fetch;
  try {
    await writeFile(file, fixture(Date.now() - 1_000), { mode: 0o600 });
    let refreshes = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith("/oauth2/token")) {
        refreshes++;
        expect(new Headers(init?.headers).get("Authorization")).toBe(`Basic ${Buffer.from("development-client:development-secret").toString("base64")}`);
        expect(new URLSearchParams(String(init?.body)).get("refresh_token")).toBe("development-refresh");
        return Response.json({ access_token: "development-renewed-access", refresh_token: "development-rotated-refresh", expires_in: 7_200 });
      }
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer development-renewed-access");
      return Response.json({ data: { id: "development-user" } });
    };
    await xRequest(await xCredentials(file), "GET", "/2/users/me");
    const persisted = await xCredentials(file);
    expect(persisted).toMatchObject({ oauth2: true, refreshToken: "development-rotated-refresh" });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await xRequest(persisted, "GET", "/2/users/me");
    expect(refreshes).toBe(1);
  } finally { globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); }
});

test("X rejects a failed refresh without sending a post or replacing stored credentials", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "oddsfront-development-x-"));
  const file = path.join(directory, "x.env");
  const originalFetch = globalThis.fetch;
  try {
    const before = fixture(Date.now() - 1_000);
    await writeFile(file, before, { mode: 0o600 });
    const calls: string[] = [];
    globalThis.fetch = async input => { calls.push(String(input)); return Response.json({ error: "development-invalid-grant" }, { status: 400 }); };
    await expect(xRequest(await xCredentials(file), "POST", "/2/tweets", { text: "development fixture" })).rejects.toThrow("X OAuth2 refresh rejected (400)");
    expect(calls).toEqual(["https://api.x.com/2/oauth2/token"]);
    expect(await readFile(file, "utf8")).toBe(before);
    expect(await readdir(directory)).toEqual(["x.env"]);
  } finally { globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); }
});

test("X does not consume a refresh token when its replacement cannot be stored", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "oddsfront-development-x-"));
  const file = path.join(directory, "x.env");
  const originalFetch = globalThis.fetch;
  try {
    const before = fixture(Date.now() - 1_000);
    await writeFile(file, before, { mode: 0o600 });
    const credentials = await xCredentials(file);
    if (!("oauth2" in credentials)) throw new Error("Expected development OAuth2 fixture");
    credentials.file = path.join(directory, "unavailable-storage", "x.env");
    const calls: string[] = [];
    globalThis.fetch = async input => {
      calls.push(String(input));
      return Response.json({ access_token: "development-new-access", refresh_token: "development-new-refresh", expires_in: 7_200 });
    };
    await expect(xRequest(credentials, "POST", "/2/tweets", { text: "development fixture" })).rejects.toThrow();
    expect(calls).toEqual([]);
    expect(await readFile(file, "utf8")).toBe(before);
  } finally { globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); }
});

test("X preserves the connection when file creation succeeds but the data quota is exhausted", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "oddsfront-development-x-"));
  const file = path.join(directory, "x.env");
  const before = fixture(Date.now() - 1_000);
  await writeFile(file, before, { mode: 0o600 });
  const probe = await open(file, "r");
  const prototype = Object.getPrototypeOf(probe);
  const originalWrite = prototype.write;
  const originalFetch = globalThis.fetch;
  try {
    const calls: string[] = [];
    prototype.write = async () => { throw Object.assign(new Error("Development disk quota exhausted"), { code: "EDQUOT" }); };
    globalThis.fetch = async input => { calls.push(String(input)); return Response.json({}); };
    await expect(xRequest(await xCredentials(file), "GET", "/2/users/me")).rejects.toThrow("quota exhausted");
    expect(calls).toEqual([]);
    expect(await readFile(file, "utf8")).toBe(before);
    expect(await readdir(directory)).toEqual(["x.env"]);
  } finally {
    prototype.write = originalWrite;
    globalThis.fetch = originalFetch;
    await probe.close();
    await rm(directory, { recursive: true, force: true });
  }
});
