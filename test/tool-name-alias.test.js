import test from "node:test";
import assert from "node:assert/strict";

import {
  collectExternalToolNameAliasesFromMessages,
  collectExternalToolNameAliasesFromText,
  filterToolCalls,
  resolveToolNameAlias
} from "../src/services/completion-core.js";

test("resolves shortened MCP and Cherry tool names to exact function names", () => {
  const cherryTools = [
    { type: "function", function: { name: "CherryFetchFetchMarkdown" } },
    { type: "function", function: { name: "CherryFetchFetchHtml" } }
  ];
  const remoteTools = [
    { type: "function", function: { name: "ZQoTa2Nx6iF9E2T9Kgbjy__fetch_markdown" } },
    { type: "function", function: { name: "ZQoTa2Nx6iF9E2T9Kgbjy__fetch_html" } }
  ];

  assert.equal(resolveToolNameAlias("fetchMarkdown", cherryTools), "CherryFetchFetchMarkdown");
  assert.equal(resolveToolNameAlias("fetch_markdown", remoteTools), "ZQoTa2Nx6iF9E2T9Kgbjy__fetch_markdown");
});

test("normalizes inspect name arguments using prior tool-list output", () => {
  const listText = [
    "- CherryFetchFetchHtml (ZQoTa2Nx6iF9E2T9Kgbjy__fetch_html): Fetch a website and return the content as HTML",
    "- CherryFetchFetchMarkdown (ZQoTa2Nx6iF9E2T9Kgbjy__fetch_markdown): Fetch a website and return the content as Markdown"
  ].join("\n");
  const aliases = collectExternalToolNameAliasesFromText(listText);

  assert.equal(aliases.get("fetch_markdown"), "CherryFetchFetchMarkdown");

  const tools = [
    {
      type: "function",
      function: {
        name: "CherryHubInspect",
        description: "Inspect a tool by name",
        parameters: {
          properties: {
            name: { type: "string", description: "tool name" }
          }
        }
      }
    },
    { type: "function", function: { name: "CherryFetchFetchMarkdown" } }
  ];
  const messageAliases = collectExternalToolNameAliasesFromMessages([{ role: "tool", content: listText }]);
  const calls = [{
    id: "call_1",
    type: "function",
    function: {
      name: "CherryHubInspect",
      arguments: JSON.stringify({ name: "fetchMarkdown" })
    }
  }];

  const filtered = filterToolCalls(calls, tools, messageAliases);

  assert.equal(filtered[0].function.arguments, JSON.stringify({ name: "CherryFetchFetchMarkdown" }));
});

test("does not rewrite ordinary business name arguments", () => {
  const tools = [
    {
      type: "function",
      function: {
        name: "createUser",
        description: "Create a user",
        parameters: {
          properties: {
            name: { type: "string", description: "user display name" }
          }
        }
      }
    },
    { type: "function", function: { name: "lookupUser" } }
  ];
  const calls = [{
    id: "call_2",
    type: "function",
    function: {
      name: "createUser",
      arguments: JSON.stringify({ name: "lookupUser" })
    }
  }];

  const filtered = filterToolCalls(calls, tools);

  assert.equal(filtered[0].function.arguments, JSON.stringify({ name: "lookupUser" }));
});
