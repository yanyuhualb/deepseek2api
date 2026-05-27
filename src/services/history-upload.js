import { config } from "../config.js";
import { degradePromptWithoutFile } from "../utils/prompt.js";
import { proxyDeepseekRequest } from "./deepseek-proxy.js";

const READY_STATUS = "SUCCESS";
const PENDING_STATUSES = new Set(["PENDING", "PARSING", "UPLOADING"]);
const HISTORY_FILE_NAME = "history.txt";

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`上传历史附件失败：上游返回非 JSON（HTTP ${response.status}）`);
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

async function uploadFile(account, text) {
  const form = new FormData();
  form.append("file", new Blob([text], { type: "text/plain; charset=utf-8" }), HISTORY_FILE_NAME);

  const { response } = await proxyDeepseekRequest({
    account,
    method: "POST",
    path: "/api/v0/file/upload_file",
    body: form
  });

  const payload = ensureBizSuccess(await readJsonResponse(response), "上传历史附件");
  const file = payload?.data?.biz_data;
  if (!file?.id) {
    throw new Error("上传历史附件失败：上游未返回文件 ID");
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

  const payload = ensureBizSuccess(await readJsonResponse(response), "查询历史附件状态");
  const file = payload?.data?.biz_data?.files?.[0];
  if (!file) {
    throw new Error(`查询历史附件状态失败：未找到文件 ${fileId}`);
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
      throw new Error(`历史附件解析失败：status=${file.status}${file.error_code ? `, error_code=${file.error_code}` : ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`历史附件解析超时（>${config.overflowUploadTimeoutMs}ms）`);
}

export async function uploadHistoryAsFile(account, text) {
  const initialFile = await uploadFile(account, text);
  if (initialFile.status === READY_STATUS) {
    return initialFile.id;
  }
  const readyFile = await waitUntilReady(account, initialFile.id);
  return readyFile.id;
}

export async function applyOverflowUpload(account, requestOptions, debugCtx) {
  const { overflowText, overflowCount, prompt } = requestOptions;
  if (!overflowText || !config.overflowUploadEnabled) {
    return { prompt: degradePromptWithoutFile(prompt), refFileIds: [] };
  }

  try {
    const fileId = await uploadHistoryAsFile(account, overflowText);
    debugCtx?.logUpstream?.(`[overflow upload] success: fileId=${fileId}, dropped=${overflowCount}, chars=${overflowText.length}`);
    return { prompt, refFileIds: [fileId] };
  } catch (error) {
    debugCtx?.logError?.(error);
    return { prompt: degradePromptWithoutFile(prompt), refFileIds: [] };
  }
}
