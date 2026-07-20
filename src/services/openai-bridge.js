import { randomUUID } from "node:crypto";

import { config } from "../config.js";
import { buildPromptWithOverflow, formatUpstreamError, wrapUpstreamError } from "../utils/prompt.js";
import { extractToolCalls } from "../utils/tool-prompt.js";
import {
  buildFcInstructions,
  completeAndParseWithRetry,
  finalizeToolCalls,
  prepareFcContext,
  renderAssistantToolCall,
  renderToolResultHeader,
  resolveFcConfig
} from "./fc-engine.js";
import {
  checkForToolCallMarker,
  collectExternalToolNameAliasesFromMessages,
  computeSafeFlushEnd,
  consumeTaggedStream,
  startCompletion,
  withCompletionSession
} from "./completion-core.js";
import { applyOverflowUpload } from "./history-upload.js";
import { uploadImages } from "./image-upload.js";
import { assertNoLegacySearchOptions, resolveOpenAiModel, resolveToolCallModel } from "./openai-request.js";

function extractContent(content) {
  if (typeof content === "string") {
    return { text: content, images: [] };
  }

  if (!Array.isArray(content)) {
    return { text: "", images: [] };
  }

  const texts = [];
  const images = [];
  for (const item of content) {
    if (item?.type === "text" && item.text) {
      texts.push(item.text);
    } else if (item?.type === "image_url" && item.image_url?.url) {
      images.push(item.image_url.url);
    }
  }
  return { text: texts.join("\n"), images };
}

function normalizeToolCall(toolCall) {
  let argsObj = {};
  try {
    argsObj = JSON.parse(toolCall.function.arguments);
  } catch {
    argsObj = {};
  }
  return renderAssistantToolCall(toolCall.function.name, argsObj);
}

function normalizeMessages(messages) {
  const images = [];
  const normalized = (messages ?? []).flatMap((message) => {
    if (message.role === "assistant" && message.tool_calls?.length) {
      const { text: content } = extractContent(message.content ?? "");
      const calls = message.tool_calls.map((tc) =>
        `[Called tool: ${tc.function.name}]\n${normalizeToolCall(tc)}`
      ).join("\n");
      return [{ role: "assistant", content: content ? `${content}\n${calls}` : calls }];
    }
    if (message.role === "tool") {
      const { text: resultText } = extractContent(message.content);
      const toolName = message.name || "unknown";
      const callId = message.tool_call_id ?? "unknown";
      return [{ role: "tool", content: `${renderToolResultHeader({ name: toolName, toolCallId: callId })}\n${resultText}` }];
    }
    const { text, images: msgImages } = extractContent(message.content);
    images.push(...msgImages);
    return [{ role: message.role ?? "user", content: text }];
  });
  return { messages: normalized, images };
}

function resolveCompletionRequest(body) {
  assertNoLegacySearchOptions(body);

  const tools = body?.tools;
  const toolChoice = body?.tool_choice;
  const fcConfig = resolveFcConfig();
  const fcContext = prepareFcContext(tools, fcConfig);
  const toolPrompt = (tools?.length && toolChoice !== "none")
    ? buildFcInstructions(fcContext.activeTools, toolChoice, fcConfig)
    : null;

  const resolvedModel = resolveOpenAiModel(body?.model);
  const model = (tools?.length) ? resolveToolCallModel(resolvedModel) : resolvedModel;

  const { messages, images } = normalizeMessages(body?.messages);
  const externalToolNameAliases = collectExternalToolNameAliasesFromMessages(messages);

  if (images.length > 0 && !model.supportsImages) {
    const error = new Error(
      `模型 ${model.id} 不支持图片输入，请改用 deepseek-v4-vision 或 deepseek-v4-vision-reasoner`
    );
    error.statusCode = 400;
    throw error;
  }

  const { prompt, overflowText, overflowCount } = buildPromptWithOverflow(
    messages,
    toolPrompt,
    config.maxPromptChars
  );

  return {
    model,
    prompt,
    overflowText,
    overflowCount,
    tools: tools || null,
    fcContext,
    externalToolNameAliases,
    images
  };
}

function buildChunkPayload(completionId, model, delta, finishReason) {
  const choice = finishReason
    ? { index: 0, delta: {}, finish_reason: finishReason }
    : { index: 0, delta };

  return {
    id: completionId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [choice]
  };
}

export async function collectOpenAiResponse({ account, body, deleteAfterFinish = false, debugCtx }) {
  const requestOptions = resolveCompletionRequest(body);
  debugCtx?.logResolved(requestOptions.model, account, !!requestOptions.tools);

  return withCompletionSession({
    account,
    body,
    deleteAfterFinish,
    onComplete: async (sessionId) => {
      try {
        const imageFileIds = await uploadImages(account, requestOptions.images, debugCtx);
        const { prompt, refFileIds } = await applyOverflowUpload(account, requestOptions, debugCtx);
        const mergedRefFileIds = [...imageFileIds, ...refFileIds];
        const upstreamRequest = { ...requestOptions, prompt };
        const { content, reasoningContent, toolCalls } = await completeAndParseWithRetry({
          account,
          requestOptions: upstreamRequest,
          sessionId,
          debugCtx,
          refFileIds: mergedRefFileIds,
          fcContext: requestOptions.fcContext,
          externalAliases: requestOptions.externalToolNameAliases
        });

        if (toolCalls) {
          const message = {
            role: "assistant",
            content: null,
            tool_calls: toolCalls
          };
          if (reasoningContent) {
            message.reasoning_content = reasoningContent;
          }
          return {
            id: `chatcmpl_${randomUUID()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: requestOptions.model.id,
            choices: [{ index: 0, finish_reason: "tool_calls", message }]
          };
        }

        const message = {
          role: "assistant",
          content
        };
        if (reasoningContent) {
          message.reasoning_content = reasoningContent;
        }
        return {
          id: `chatcmpl_${randomUUID()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: requestOptions.model.id,
          choices: [{ index: 0, finish_reason: "stop", message }]
        };
      } catch (error) {
        throw wrapUpstreamError(error, requestOptions.prompt?.length);
      }
    }
  });
}

function buildToolCallChunkPayload(completionId, model, toolCalls, finishReason) {
  const toolCallDeltas = toolCalls.map((tc, index) => ({
    index,
    id: tc.id,
    type: "function",
    function: { name: tc.function.name, arguments: tc.function.arguments }
  }));

  const choice = finishReason
    ? { index: 0, delta: {}, finish_reason: finishReason }
    : { index: 0, delta: { tool_calls: toolCallDeltas } };

  return {
    id: completionId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [choice]
  };
}

export async function streamOpenAiResponse(options) {
  const { account, body, deleteAfterFinish = false, response, debugCtx } = options;
  const completionId = `chatcmpl_${randomUUID()}`;
  const requestOptions = resolveCompletionRequest(body);
  debugCtx?.logResolved(requestOptions.model, account, !!requestOptions.tools);

  return withCompletionSession({
    account,
    body,
    deleteAfterFinish,
    onComplete: async (sessionId) => {
      const imageFileIds = await uploadImages(account, requestOptions.images, debugCtx);
      const { prompt, refFileIds } = await applyOverflowUpload(account, requestOptions, debugCtx);
      const mergedRefFileIds = [...imageFileIds, ...refFileIds];
      const upstreamRequest = { ...requestOptions, prompt };
      const { response: deepseekResponse } = await startCompletion({
        account,
        requestOptions: upstreamRequest,
        sessionId,
        debugCtx,
        refFileIds: mergedRefFileIds
      });

      response.writeHead(200, {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no"
      });
      response.flushHeaders?.();

      response.write(
        `data: ${JSON.stringify(buildChunkPayload(
          completionId,
          requestOptions.model.id,
          { role: "assistant" }
        ))}\n\n`
      );

      let toolCallDetected = false;
      let toolCallBuffer = "";
      let textBuffer = "";
      let decidedAsText = false;
      let upstreamError = null;

      function trySwitchToToolCall() {
        const markerIdx = checkForToolCallMarker(textBuffer);
        if (markerIdx !== -1) {
          const before = textBuffer.slice(0, markerIdx);
          debugCtx?.logToolDetection({
            markerFound: true,
            markerIndex: markerIdx,
            textBeforeMarker: before.slice(-100),
            markerPrefix: textBuffer.slice(markerIdx, markerIdx + 30)
          });
          if (before) {
            response.write(
              `data: ${JSON.stringify(buildChunkPayload(completionId, requestOptions.model.id, { content: before }))}\n\n`
            );
          }
          toolCallDetected = true;
          toolCallBuffer = textBuffer.slice(markerIdx);
          textBuffer = "";
          return true;
        }
        return false;
      }

      await consumeTaggedStream(deepseekResponse.body, (tagged) => {
        if (tagged.kind === "error") {
          upstreamError = tagged;
          return;
        }
        if (upstreamError) return;

        if (tagged.kind === "thinking") {
          response.write(
            `data: ${JSON.stringify(buildChunkPayload(completionId, requestOptions.model.id, { reasoning_content: tagged.text }))}\n\n`
          );
          return;
        }

        const text = tagged.text;

        if (toolCallDetected) {
          toolCallBuffer += text;
          return;
        }

        textBuffer += text;

        if (trySwitchToToolCall()) return;

        const safeEnd = computeSafeFlushEnd(textBuffer);

        const toStream = textBuffer.slice(0, safeEnd);
        textBuffer = textBuffer.slice(safeEnd);

        if (toStream) {
          decidedAsText = true;
          response.write(
            `data: ${JSON.stringify(buildChunkPayload(completionId, requestOptions.model.id, { content: toStream }))}\n\n`
          );
        }
      }, debugCtx);

      if (upstreamError) {
        const friendlyText = formatUpstreamError(upstreamError.text, requestOptions.prompt?.length);
        debugCtx?.logFinalResponse({ error: friendlyText, code: upstreamError.code });
        response.write(
          `data: ${JSON.stringify(buildChunkPayload(completionId, requestOptions.model.id, { content: `[Error: ${friendlyText}]` }))}\n\n`
        );
        response.write(
          `data: ${JSON.stringify(buildChunkPayload(completionId, requestOptions.model.id, "", "stop"))}\n\n`
        );
        response.end("data: [DONE]\n\n");
        return;
      }

      if (textBuffer && !toolCallDetected) {
        if (!decidedAsText || checkForToolCallMarker(textBuffer) !== -1) {
          if (!decidedAsText) {
            const detected = requestOptions.tools?.length
              ? finalizeToolCalls(textBuffer, requestOptions.tools, requestOptions.fcContext, requestOptions.externalToolNameAliases, debugCtx)
              : extractToolCalls(textBuffer, debugCtx);
            if (detected) {
              toolCallDetected = true;
              toolCallBuffer = textBuffer;
              textBuffer = "";
            }
          } else {
            if (trySwitchToToolCall()) {
              // switched
            }
          }
        }
        if (textBuffer && !toolCallDetected) {
          response.write(
            `data: ${JSON.stringify(buildChunkPayload(completionId, requestOptions.model.id, { content: textBuffer }))}\n\n`
          );
        }
      }

      if (toolCallDetected) {
        const toolCalls = requestOptions.tools?.length
          ? finalizeToolCalls(toolCallBuffer, requestOptions.tools, requestOptions.fcContext, requestOptions.externalToolNameAliases, debugCtx)
          : (extractToolCalls(toolCallBuffer, debugCtx) || null);
        debugCtx?.logToolDetection({
          toolCallBufferLength: toolCallBuffer.length,
          rawToolCallCount: toolCalls?.length ?? 0,
          filteredToolCallCount: toolCalls?.length ?? 0,
          toolCalls: toolCalls?.map(tc => ({ name: tc.function.name, id: tc.id })) ?? []
        });
        debugCtx?.logFinalResponse({ finishReason: toolCalls ? "tool_calls" : "stop" });
        if (toolCalls) {
          response.write(
            `data: ${JSON.stringify(buildToolCallChunkPayload(completionId, requestOptions.model.id, toolCalls))}\n\n`
          );
          response.write(
            `data: ${JSON.stringify(buildToolCallChunkPayload(completionId, requestOptions.model.id, [], "tool_calls"))}\n\n`
          );
        } else {
          response.write(
            `data: ${JSON.stringify(buildChunkPayload(completionId, requestOptions.model.id, { content: toolCallBuffer }))}\n\n`
          );
          response.write(
            `data: ${JSON.stringify(buildChunkPayload(completionId, requestOptions.model.id, "", "stop"))}\n\n`
          );
        }
      } else {
        debugCtx?.logFinalResponse({ finishReason: "stop" });
        response.write(
          `data: ${JSON.stringify(buildChunkPayload(completionId, requestOptions.model.id, "", "stop"))}\n\n`
        );
      }

      response.end("data: [DONE]\n\n");
    }
  });
}
