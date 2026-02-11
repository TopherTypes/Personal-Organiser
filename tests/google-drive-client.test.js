import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createGoogleDriveClient, mapDriveApiError } from "../src/modules/google-drive-client.js";

function createJsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function createTextResponse(text, { status = 200 } = {}) {
  return new Response(text, { status, headers: { "Content-Type": "text/plain" } });
}

test("transport error mapping marks retryable Drive failures as transient", () => {
  const throttled = mapDriveApiError({ operation: "pull", status: 429, errorText: "Rate limit exceeded" });
  assert.equal(throttled.transient, true);

  const invalidRequest = mapDriveApiError({ operation: "push", status: 400, errorText: "invalid argument" });
  assert.equal(invalidRequest.transient, false);
});

test("push/pull round-trip normalizes payload and provisions SecondBrain file layout", async () => {
  const folders = [];
  const files = [];
  const fileContent = new Map();

  const fetchImpl = async (url, options = {}) => {
    const method = (options.method || "GET").toUpperCase();
    const parsed = new URL(url);

    if (parsed.hostname !== "www.googleapis.com") {
      return createTextResponse("unexpected host", { status: 500 });
    }

    if (method === "GET" && parsed.pathname === "/drive/v3/files" && parsed.searchParams.get("q")?.includes("SecondBrain")) {
      return createJsonResponse({ files: folders });
    }

    if (method === "POST" && parsed.pathname === "/drive/v3/files") {
      const payload = JSON.parse(options.body || "{}");
      if (payload.mimeType === "application/vnd.google-apps.folder") {
        const folder = { id: "folder-1", name: payload.name, mimeType: payload.mimeType };
        folders.push(folder);
        return createJsonResponse(folder);
      }

      const file = {
        id: `file-${files.length + 1}`,
        name: payload.name,
        mimeType: payload.mimeType,
        parents: payload.parents || []
      };
      files.push(file);
      return createJsonResponse(file);
    }

    if (method === "GET" && parsed.pathname === "/drive/v3/files" && parsed.searchParams.get("q")?.includes("in parents")) {
      const query = decodeURIComponent(parsed.searchParams.get("q") || "");
      const match = /name = '([^']+)'/.exec(query);
      const wantedName = match ? match[1] : "";
      const matchFile = files.find((item) => item.name === wantedName);
      return createJsonResponse({ files: matchFile ? [matchFile] : [] });
    }

    if (method === "PATCH" && parsed.pathname.startsWith("/upload/drive/v3/files/")) {
      const id = parsed.pathname.split("/").pop();
      fileContent.set(id, String(options.body || ""));
      return createTextResponse("", { status: 200 });
    }

    if (method === "GET" && parsed.pathname.startsWith("/drive/v3/files/") && parsed.searchParams.get("alt") === "media") {
      const id = parsed.pathname.split("/").pop();
      if (!fileContent.has(id)) {
        return createTextResponse("not found", { status: 404 });
      }

      return createTextResponse(fileContent.get(id), { status: 200 });
    }

    return createTextResponse(`Unhandled route: ${method} ${parsed.pathname}${parsed.search}`, { status: 500 });
  };

  const client = createGoogleDriveClient({
    authClient: { getAccessToken: async () => "token" },
    fetchImpl
  });

  const input = {
    updatedAt: "2025-01-01T00:00:00.000Z",
    tasks: [
      {
        id: "task-1",
        title: "Ship feature",
        meta: { z: 2, a: 1 }
      }
    ],
    zeta: true,
    alpha: false
  };

  await client.pushDocument("work.tasks", input);
  const pulled = await client.pullDocument("work.tasks");

  assert.deepEqual(pulled, {
    alpha: false,
    tasks: [
      {
        id: "task-1",
        meta: { a: 1, z: 2 },
        title: "Ship feature"
      }
    ],
    updatedAt: "2025-01-01T00:00:00.000Z",
    zeta: true
  });

  const names = files.map((item) => item.name).sort();
  assert.deepEqual(names, ["meta.json", "personal.json", "work.json"]);
});
