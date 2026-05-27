const TRUNCATION_PLACEHOLDER = "[... 较早的对话历史因长度超过上下文限制已省略 ...]";
const TRUNCATION_WITH_FILE_PLACEHOLDER = "[... 较早的对话历史因长度超过上下文限制，已打包到附件 history.txt 中，请优先参考附件内容 ...]";
const OVERFLOW_FILE_HEADER = "# 较早对话历史 (因长度超过模型上下文窗口，已分离到附件)\n# 按时间顺序排列，请结合主对话上下文一起理解\n";

const CONTEXT_LENGTH_HINTS = ["超长", "过长", "超出", "请删减", "context length", "too long", "exceed"];

export function degradePromptWithoutFile(prompt) {
  if (!prompt) return prompt;
  return prompt.replace(TRUNCATION_WITH_FILE_PLACEHOLDER, TRUNCATION_PLACEHOLDER);
}

export function isContextLengthError(text) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  return CONTEXT_LENGTH_HINTS.some((kw) => lower.includes(kw.toLowerCase()));
}

export function formatUpstreamError(originalText, promptLength) {
  const text = originalText || "上游错误";
  if (!isContextLengthError(text)) return text;
  const lenInfo = promptLength ? `当前拼接后 prompt ≈ ${promptLength} 字符` : "";
  const hint = "建议：开启新对话/减少历史消息，或在 .env 中调大 MAX_PROMPT_CHARS 后重启服务";
  return [text, lenInfo, hint].filter(Boolean).join("；");
}

export function wrapUpstreamError(error, promptLength) {
  if (!error?.message) return error;
  const friendly = formatUpstreamError(error.message, promptLength);
  if (friendly === error.message) return error;
  const wrapped = new Error(friendly);
  wrapped.code = error.code;
  wrapped.statusCode = error.statusCode ?? 400;
  return wrapped;
}

function formatMessage(message) {
  const role = (message?.role ?? "user").toString().toUpperCase();
  const content = message?.content ?? "";
  return `${role}: ${content}`;
}

function joinFormatted(prefix, parts) {
  return prefix + parts.join("\n\n");
}

function splitMessagesByBudget(messages, budget, placeholder) {
  const systems = [];
  const others = [];
  for (const m of messages) {
    if ((m?.role ?? "").toLowerCase() === "system") {
      systems.push(m);
    } else {
      others.push(m);
    }
  }

  const systemTexts = systems.map(formatMessage);
  const systemCost = systemTexts.reduce((acc, t) => acc + t.length + 2, 0);
  const placeholderCost = placeholder.length + 2;

  let remaining = budget - systemCost - placeholderCost;
  const keptTailMessages = [];
  const keptTailTexts = [];

  for (let i = others.length - 1; i >= 0; i--) {
    const text = formatMessage(others[i]);
    const cost = text.length + 2;
    if (cost <= remaining) {
      keptTailMessages.unshift(others[i]);
      keptTailTexts.unshift(text);
      remaining -= cost;
    } else {
      break;
    }
  }

  if (keptTailTexts.length === 0 && others.length > 0) {
    const lastMessage = others[others.length - 1];
    const lastText = formatMessage(lastMessage);
    const limit = Math.max(0, budget - systemCost - placeholderCost);
    keptTailTexts.push(lastText.slice(-limit));
    keptTailMessages.push({ ...lastMessage, content: String(lastMessage.content ?? "").slice(-limit) });
  }

  const droppedMessages = others.slice(0, others.length - keptTailMessages.length);
  return { systemTexts, keptTailTexts, droppedMessages };
}

export function buildPromptFromMessages(messages, toolPrompt, maxChars = 0) {
  const prefix = toolPrompt ? `SYSTEM: ${toolPrompt}\n\n` : "";
  const list = messages ?? [];

  if (!maxChars || maxChars <= 0) {
    return joinFormatted(prefix, list.map(formatMessage));
  }

  const fullParts = list.map(formatMessage);
  const fullLength = prefix.length + fullParts.reduce((acc, t, i) => acc + t.length + (i > 0 ? 2 : 0), 0);
  if (fullLength <= maxChars) {
    return joinFormatted(prefix, fullParts);
  }

  const budget = Math.max(0, maxChars - prefix.length);
  const { systemTexts, keptTailTexts, droppedMessages } = splitMessagesByBudget(list, budget, TRUNCATION_PLACEHOLDER);
  const parts = [...systemTexts];
  if (droppedMessages.length > 0) parts.push(TRUNCATION_PLACEHOLDER);
  parts.push(...keptTailTexts);
  return joinFormatted(prefix, parts);
}

export function buildPromptWithOverflow(messages, toolPrompt, maxChars = 0) {
  const prefix = toolPrompt ? `SYSTEM: ${toolPrompt}\n\n` : "";
  const list = messages ?? [];

  if (!maxChars || maxChars <= 0) {
    return { prompt: joinFormatted(prefix, list.map(formatMessage)), overflowText: null, overflowCount: 0 };
  }

  const fullParts = list.map(formatMessage);
  const fullLength = prefix.length + fullParts.reduce((acc, t, i) => acc + t.length + (i > 0 ? 2 : 0), 0);
  if (fullLength <= maxChars) {
    return { prompt: joinFormatted(prefix, fullParts), overflowText: null, overflowCount: 0 };
  }

  const budget = Math.max(0, maxChars - prefix.length);
  const { systemTexts, keptTailTexts, droppedMessages } = splitMessagesByBudget(list, budget, TRUNCATION_WITH_FILE_PLACEHOLDER);

  const parts = [...systemTexts];
  if (droppedMessages.length > 0) parts.push(TRUNCATION_WITH_FILE_PLACEHOLDER);
  parts.push(...keptTailTexts);

  const overflowText = droppedMessages.length > 0
    ? OVERFLOW_FILE_HEADER + "\n" + droppedMessages.map(formatMessage).join("\n\n") + "\n"
    : null;

  return { prompt: joinFormatted(prefix, parts), overflowText, overflowCount: droppedMessages.length };
}
