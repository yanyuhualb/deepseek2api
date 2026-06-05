import { Buffer } from "node:buffer";

import { config } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch-with-timeout.js";
import { proxyDeepseekRequest } from "./deepseek-proxy.js";

const READY_STATUS = "SUCCESS";
const PENDING_STATUSES = new Set(["PENDING", "PARSING", "UPLOADING"]);

const MIME_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp"
};

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`上传图片失败：上游返回非 JSON（HTTP ${response.status}）`);
  }
}

function ensureBizSuccess(payload, action) {
  const bizCode = payload?.data?.biz_code;
  if (typeof bizCode === "number" && bizCode !== 0) {
    const reason = payload?.data?.biz_msg || payload?.msg || `biz_code=${bizCode}`;
    throw new Error(`${action}失败：${reason}`);
  }
  return payload;
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl);
  if (!match) {
    throw new Error("无法解析图片 data URL");
  }
  const mime = (match[1] || "image/png").toLowerCase();
  const isBase64 = !!match[2];
  const payload = match[3];
  const buffer = isBase64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  return { mime, buffer };
}

async function fetchRemoteImage(url) {
  const response = await fetchWithTimeout(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`下载图片失败：HTTP ${response.status}`);
  }
  const contentType = (response.headers.get("content-type") ?? "image/png")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const buffer = Buffer.from(await response.arrayBuffer());
  return { mime: contentType, buffer };
}

async function loadImage(url) {
  if (/^data:/i.test(url)) return parseDataUrl(url);
  if (/^https?:\/\//i.test(url)) return fetchRemoteImage(url);
  throw new Error(`不支持的图片地址（仅支持 data: 与 http(s):）`);
}

async function uploadBlob(account, { buffer, mime, filename }) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime }), filename);

  const { response } = await proxyDeepseekRequest({
    account,
    method: "POST",
    path: "/api/v0/file/upload_file",
    body: form
  });

  const payload = ensureBizSuccess(await readJsonResponse(response), "上传图片");
  const file = payload?.data?.biz_data;
  if (!file?.id) {
    throw new Error("上传图片失败：上游未返回文件 ID");
  }
  return file;
}

async function fetchFileStatus(account, fileId) {
  const { response } = await proxyDeepseekRequest({
    account,
    method: "GET",
    path: "/api/v0/file/fetch_files",
    query: { file_ids: fileId }
  });
  const payload = ensureBizSuccess(await readJsonResponse(response), "查询图片状态");
  const file = payload?.data?.biz_data?.files?.[0];
  if (!file) {
    throw new Error(`查询图片状态失败：未找到文件 ${fileId}`);
  }
  return file;
}

async function waitUntilReady(account, fileId) {
  const deadline = Date.now() + config.overflowUploadTimeoutMs;
  const interval = Math.max(200, config.overflowUploadPollIntervalMs);
  while (Date.now() < deadline) {
    const file = await fetchFileStatus(account, fileId);
    if (file.status === READY_STATUS) return file;
    if (!PENDING_STATUSES.has(file.status)) {
      throw new Error(
        `图片解析失败：status=${file.status}${file.error_code ? `, error_code=${file.error_code}` : ""}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`图片解析超时（>${config.overflowUploadTimeoutMs}ms）`);
}

async function uploadOne(account, url, index) {
  const { buffer, mime } = await loadImage(url);
  const ext = MIME_EXTENSIONS[mime] || "png";
  const filename = `image-${index + 1}.${ext}`;
  const initial = await uploadBlob(account, { buffer, mime, filename });
  if (initial.status === READY_STATUS) return initial.id;
  const ready = await waitUntilReady(account, initial.id);
  return ready.id;
}

export async function uploadImages(account, urls, debugCtx) {
  if (!urls || urls.length === 0) return [];
  const ids = [];
  for (let i = 0; i < urls.length; i++) {
    const id = await uploadOne(account, urls[i], i);
    debugCtx?.logUpstream?.(`[image upload] success: fileId=${id}, index=${i + 1}/${urls.length}`);
    ids.push(id);
  }
  return ids;
}
