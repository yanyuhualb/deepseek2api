import test from "node:test";
import assert from "node:assert/strict";

import {
  buildToolInstructions,
  coerceToolInput,
  openAIToolCalls,
  parseToolCalls,
  ParsedToolCall,
  ProtocolSpec,
  renderToolCall,
  ToolCallConfig,
  ToolSieve
} from "../src/utils/xyml.js";
import {
  analyzeFcRecovery,
  buildFcInstructions,
  finalizeToolCalls,
  isToolCallTruncated,
  prepareFcContext,
  renderAssistantToolCall,
  toSafeName,
  fromSafeName
} from "../src/services/fc-engine.js";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get weather by city",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "City name" },
          days: { type: "integer", description: "Forecast days" },
          tags: { type: "array", items: { type: "string" } }
        },
        required: ["city"]
      }
    }
  }
];

function cfg(overrides = {}) {
  return new ToolCallConfig({
    emitProtocol: "XYML",
    parseProtocols: [new ProtocolSpec("XYML"), new ProtocolSpec("QNML", { parseOnly: true })],
    unknownTool: "drop",
    missingRequired: "drop",
    ...overrides
  });
}

test("renderToolCall emits XYML block with CDATA for strings", () => {
  const out = renderToolCall("get_weather", { city: "Tokyo", days: 3 }, { config: cfg() });
  assert.match(out, /<\|XYML\|tool_calls>/);
  assert.match(out, /<\|XYML\|invoke name="get_weather">/);
  assert.match(out, /<\|XYML\|parameter name="city"><!\[CDATA\[Tokyo\]\]><\/\|XYML\|parameter>/);
  assert.match(out, /<\|XYML\|parameter name="days">3<\/\|XYML\|parameter>/);
});

test("parseToolCalls parses XYML block back into a call", () => {
  const text = renderToolCall("get_weather", { city: "Tokyo", days: 3 }, { config: cfg() });
  const calls = parseToolCalls(text, TOOLS, { config: cfg() });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "get_weather");
  assert.equal(calls[0].input.city, "Tokyo");
  assert.equal(calls[0].input.days, 3);
  assert.match(calls[0].id, /^call_/);
});

test("parseToolCalls coerces JSON array string into a real array per schema", () => {
  const arr = ["a", "b"];
  const text = renderToolCall("get_weather", { city: "X", tags: JSON.stringify(arr) }, { config: cfg() });
  const calls = parseToolCalls(text, TOOLS, { config: cfg() });
  assert.deepEqual(calls[0].input.tags, ["a", "b"]);
});

test("parseToolCalls still parses legacy tool_call XML wrapper", () => {
  const payload = { name: "get_weather", arguments: { city: "Paris" } };
  const open = String.fromCharCode(60) + "tool_call>";
  const close = String.fromCharCode(60) + "/tool_call>";
  const text = open + JSON.stringify(payload) + close;
  const calls = parseToolCalls(text, TOOLS, { config: cfg() });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "get_weather");
  assert.equal(calls[0].input.city, "Paris");
});

test("parseToolCalls parses bare JSON with name and arguments", () => {
  const text = "Sure! " + JSON.stringify({ name: "get_weather", arguments: { city: "Berlin" } });
  const calls = parseToolCalls(text, TOOLS, { config: cfg() });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.city, "Berlin");
});

test("parseToolCalls deduplicates identical calls", () => {
  const block = renderToolCall("get_weather", { city: "Tokyo" }, { config: cfg() });
  const calls = parseToolCalls(block + "\n\n" + block, TOOLS, { config: cfg() });
  assert.equal(calls.length, 1);
});

test("parseToolCalls drops calls missing required args when missingRequired=drop", () => {
  const block = renderToolCall("get_weather", { days: 3 }, { config: cfg() });
  const calls = parseToolCalls(block, TOOLS, { config: cfg({ missingRequired: "drop" }) });
  assert.equal(calls.length, 0);
});

test("parseToolCalls keeps calls missing required args when missingRequired=keep", () => {
  const block = renderToolCall("get_weather", { days: 3 }, { config: cfg() });
  const calls = parseToolCalls(block, TOOLS, { config: cfg({ missingRequired: "keep" }) });
  assert.equal(calls.length, 1);
});

test("parseToolCalls drops calls with polluted path-like args", () => {
  const tools = [{
    type: "function",
    function: {
      name: "read_file",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
    }
  }];
  const polluted = "<|XYML|tool_calls>";
  const block = renderToolCall("read_file", { path: polluted }, { config: cfg() });
  const calls = parseToolCalls(block, tools, { config: cfg() });
  assert.equal(calls.length, 0);
});

test("parseToolCalls canonicalizes fullwidth markup back to ASCII", () => {
  const open = "\uff1c|XYML|tool_calls\uff1e";
  const invoke = "  \uff1c|XYML|invoke name=\"get_weather\"\uff1e";
  const param = "    \uff1c|XYML|parameter name=\"city\"\uff1e<![CDATA[Osaka]]>\uff1c/|XYML|parameter\uff1e";
  const closeInvoke = "  \uff1c/|XYML|invoke\uff1e";
  const closeRoot = "\uff1c/|XYML|tool_calls\uff1e";
  const text = [open, invoke, param, closeInvoke, closeRoot].join("\n");
  const calls = parseToolCalls(text, TOOLS, { config: cfg() });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.city, "Osaka");
});

test("parseToolCalls resolves safe aliases (fs_open_file -> Read)", () => {
  const tools = [{
    type: "function",
    function: { name: "Read", parameters: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] } }
  }];
  const block = renderToolCall("fs_open_file", { file_path: "/tmp/x" }, { config: cfg() });
  const calls = parseToolCalls(block, tools, { config: cfg() });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "Read");
});

test("coerceToolInput renames aliases for Read and Bash", () => {
  assert.deepEqual(coerceToolInput("Read", { path: "/a" }, TOOLS), { file_path: "/a" });
  assert.deepEqual(coerceToolInput("Bash", { cmd: "ls" }, TOOLS), { command: "ls" });
});

test("openAIToolCalls serializes input as JSON string", () => {
  const calls = openAIToolCalls([new ParsedToolCall({ name: "get_weather", input: { city: "Tokyo" } })]);
  assert.equal(calls[0].type, "function");
  assert.equal(calls[0].function.name, "get_weather");
  assert.equal(calls[0].function.arguments, JSON.stringify({ city: "Tokyo" }));
});

test("ToolSieve splits streamed text from tool-call envelope", () => {
  const sieve = new ToolSieve(TOOLS, { config: cfg(), holdLength: 16 });
  const events = [];
  for (const ev of sieve.processChunk("Hello! ")) events.push(...[ev].flat());
  const block = renderToolCall("get_weather", { city: "Tokyo" }, { config: cfg() });
  for (const ev of sieve.processChunk(block)) events.push(...[ev].flat());
  events.push(...sieve.flush());
  const content = events.filter((e) => e.type === "content").map((e) => e.text).join("");
  const toolEvents = events.filter((e) => e.type === "tool_calls");
  assert.equal(content, "Hello! ");
  assert.equal(toolEvents.length, 1);
  assert.equal(toolEvents[0].calls[0].name, "get_weather");
});

test("buildToolInstructions includes protocol header and tool names", () => {
  const instructions = buildToolInstructions(TOOLS, { config: cfg() });
  assert.match(instructions, /=== XYML TOOL CALL PROTOCOL ===/);
  assert.match(instructions, /get_weather/);
  assert.match(instructions, /Available action names:/);
});

test("buildFcInstructions returns null when no tools or choice=none", () => {
  assert.equal(buildFcInstructions([], "auto"), null);
  assert.equal(buildFcInstructions(TOOLS, "none"), null);
});

test("buildFcInstructions appends required/forced choice directives", () => {
  const req = buildFcInstructions(TOOLS, "required");
  assert.match(req, /You MUST call at least one tool/);
  const forced = buildFcInstructions(TOOLS, { function: { name: "get_weather" } });
  assert.match(forced, /You MUST call the function "get_weather"/);
});

test("renderAssistantToolCall produces an XYML block", () => {
  const out = renderAssistantToolCall("get_weather", { city: "X" });
  assert.match(out, /<\|XYML\|tool_calls>/);
  assert.match(out, /name="get_weather"/);
});

test("toSafeName/fromSafeName round-trips obfuscated names", () => {
  assert.equal(toSafeName("Read"), "fs_open_file");
  assert.equal(fromSafeName("fs_open_file"), "Read");
  assert.equal(toSafeName("MyTool"), "u_MyTool");
  assert.equal(fromSafeName("u_MyTool"), "MyTool");
});

test("prepareFcContext obfuscates tools when enabled", () => {
  const tools = [{
    type: "function",
    function: { name: "GetWeather", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }
  }];
  const fcConfig = { obfuscateToolNames: true, protocol: "XYML", unknownTool: "keep", missingRequired: "keep", promptStyle: "standard" };
  const ctx = prepareFcContext(tools, fcConfig);
  assert.notEqual(ctx.activeTools[0].function.name, "GetWeather");
  assert.equal(ctx.nameMap[ctx.activeTools[0].function.name], "GetWeather");
});

test("finalizeToolCalls parses XYML and returns OpenAI-shaped calls", () => {
  const fcConfig = { protocol: "XYML", unknownTool: "keep", missingRequired: "keep", promptStyle: "standard", stripThinkTags: true, obfuscateToolNames: false };
  const ctx = prepareFcContext(TOOLS, fcConfig);
  const text = renderAssistantToolCall("get_weather", { city: "Tokyo" });
  const calls = finalizeToolCalls(text, TOOLS, ctx, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "get_weather");
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { city: "Tokyo" });
});

test("finalizeToolCalls strips think tags before parsing", () => {
  const fcConfig = { protocol: "XYML", unknownTool: "keep", missingRequired: "keep", promptStyle: "standard", stripThinkTags: true, obfuscateToolNames: false };
  const ctx = prepareFcContext(TOOLS, fcConfig);
  const think = "<think>let me check the weather</think>";
  const block = renderAssistantToolCall("get_weather", { city: "Tokyo" });
  const calls = finalizeToolCalls(think + "\n" + block, TOOLS, ctx, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "get_weather");
});

test("isToolCallTruncated detects open envelope without close", () => {
  const open = "<|XYML|tool_calls>";
  assert.equal(isToolCallTruncated(open + " some content"), true);
  assert.equal(isToolCallTruncated("just plain text"), false);
});

test("analyzeFcRecovery flags truncated envelope", () => {
  const fcConfig = { protocol: "XYML", unknownTool: "keep", missingRequired: "keep", promptStyle: "standard", stripThinkTags: true };
  const open = "<|XYML|tool_calls>";
  const analysis = analyzeFcRecovery(open + " incomplete", TOOLS, fcConfig);
  assert.equal(analysis.reason, "truncated");
  assert.match(analysis.retryMessage, /truncated/);
});
