import { resolveAccountLabel } from "/account-display.js";
import { escapeHtml } from "/html-escape.js";
const TAB_LABELS = Object.freeze({
  accounts: "账号",
  admin: "管理",
  chat: "聊天",
  explorer: "代理",
  keys: "密钥"
});
const FILE_STATUS_LABELS = Object.freeze({
  FAILED: "失败",
  PARSING: "解析中",
  PENDING: "等待中",
  SUCCESS: "已完成",
  UPLOADING: "上传中"
});
function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function createEmptyState(title, description) {
  return `
    <article class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(description)}</span>
    </article>
  `;
}
function resolveFileStatus(file) {
  if (file.errorCode) {
    return `${FILE_STATUS_LABELS.FAILED} (${escapeHtml(file.errorCode)})`;
  }
  return FILE_STATUS_LABELS[file.status] ?? escapeHtml(file.status || "UNKNOWN");
}
function renderFileMarkup(file, options = {}) {
  const { deletable = false } = options;
  const deleteButton = deletable
    ? `
      <button
        type="button"
        class="button-ghost"
        data-draft-file-id="${escapeHtml(file.localId)}"
        data-ripple
      >
        删除
      </button>
    `
    : "";
  return `
    <article class="file-item ${escapeHtml(String(file.status || "").toLowerCase())}">
      <div class="file-info">
        <strong>${escapeHtml(file.fileName)}</strong>
        <span class="file-meta">${resolveFileStatus(file)} · ${escapeHtml(formatFileSize(file.fileSize))}</span>
      </div>
      ${deleteButton}
    </article>
  `;
}
function renderFileListMarkup(files, options = {}) {
  if (!files?.length) {
    return "";
  }

  const className = options.className ?? "file-list";
  return `
    <div class="${className}">
      ${files.map((file) => renderFileMarkup(file, options)).join("")}
    </div>
  `;
}
function renderApiKeyMarkup(key) {
  return `
    <article class="key-item">
      <div class="key-info">
        <strong>${escapeHtml(key.label)}</strong>
        <span class="key-preview">${escapeHtml(key.preview)}</span>
      </div>
      <div class="inline-actions">
        <button
          type="button"
          class="button-ghost button-danger"
          data-key-id="${escapeHtml(key.id)}"
          data-ripple
        >
          删除
        </button>
      </div>
    </article>
  `;
}
function createRipple({ event, target }) {
  const rect = target.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const ripple = document.createElement("span");
  ripple.className = "button-ripple";
  ripple.style.height = `${size}px`;
  ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
  ripple.style.width = `${size}px`;
  target.appendChild(ripple);
  window.setTimeout(() => ripple.remove(), 720);
}
export function setActiveTab(tab) {
  document.body.dataset.activeTab = tab;
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const isActive = button.dataset.tab === tab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  document.querySelectorAll(".tab-pane").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== `tab-${tab}`);
  });
  document.dispatchEvent(new CustomEvent("apptabchange", { detail: { tab } }));
}
export function setupTabs() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.onclick = () => setActiveTab(button.dataset.tab);
  });
}
export function renderAccountOptions({ accounts, select, selectedAccountId }) {
  select.innerHTML = accounts.length
    ? accounts.map((account) => {
        const label = resolveAccountLabel(account);
        return `<option value="${escapeHtml(account.id)}">${escapeHtml(label)}</option>`;
      }).join("")
    : '<option value="">暂无可用账号</option>';
  select.value = selectedAccountId;
}
export function renderDraftFileList({ container, files, onDelete }) {
  container.innerHTML = renderFileListMarkup(files, {
    className: "draft-file-list",
    deletable: true
  });
  container.querySelectorAll("[data-draft-file-id]").forEach((button) => {
    button.onclick = () => onDelete(button.dataset.draftFileId);
  });
}
export function renderApiKeyList({ container, keys, onDelete }) {
  container.innerHTML = keys.length
    ? keys.map(renderApiKeyMarkup).join("")
    : createEmptyState("暂无密钥", "创建后显示在这里。");
  container.querySelectorAll("[data-key-id]").forEach((button) => {
    button.onclick = () => onDelete(button.dataset.keyId);
  });
}
export function setSelectOptions({ select, values }) {
  select.innerHTML = values.length
    ? values.map((value) => `<option>${escapeHtml(value)}</option>`).join("")
    : '<option value="">暂无路径</option>';
}
export function updateDashboardMetrics(options) {
  const {
    apiKeyCountElement,
    endpointCountElement,
    messageCountElement,
    sessionCaptionElement,
    sessionCountElement,
    sessionMetricElement,
    counts
  } = options;
  apiKeyCountElement.textContent = String(counts.apiKeys);
  endpointCountElement.textContent = String(counts.endpoints);
  messageCountElement.textContent = String(counts.messages);
  sessionCountElement.textContent = String(counts.sessions);
  sessionMetricElement.textContent = String(counts.sessions);
  sessionCaptionElement.textContent = counts.sessions
    ? `共 ${counts.sessions} 个会话`
    : "暂无会话";
}
export function wireRippleEffects() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-ripple]");
    if (target) {
      createRipple({ event, target });
    }
  });
}

export function getActiveTab() {
  return document.body.dataset.activeTab || "chat";
}

export function resolveTabLabel(tab) {
  return TAB_LABELS[tab] ?? TAB_LABELS.chat;
}

export function setPageTitle(title) {
  const titleElement = document.getElementById("page-title");
  if (titleElement) {
    titleElement.textContent = title;
  }
}
