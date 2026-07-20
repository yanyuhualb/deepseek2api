// Model catalog — mirrors src/services/openai-request.js BASE_OPENAI_MODELS.

export interface ModelOption {
  id: string;
  label: string;
  modelType: string;
  thinkingEnabled: boolean;
  searchEnabled: boolean;
  supportsImages?: boolean;
  group: string;
}

const BASE: Omit<ModelOption, "id" | "label" | "searchEnabled" | "group">[] = [
  { modelType: "default", thinkingEnabled: false },
  { modelType: "default", thinkingEnabled: true },
  { modelType: "expert", thinkingEnabled: false },
  { modelType: "expert", thinkingEnabled: true },
  { modelType: "default", thinkingEnabled: false },
  { modelType: "default", thinkingEnabled: true },
  { modelType: "expert", thinkingEnabled: false },
  { modelType: "expert", thinkingEnabled: true },
  { modelType: "vision", thinkingEnabled: false, supportsImages: true },
  { modelType: "vision", thinkingEnabled: true, supportsImages: true }
];

const NAMES = [
  "deepseek-chat-fast",
  "deepseek-reasoner-fast",
  "deepseek-chat-expert",
  "deepseek-reasoner-expert",
  "deepseek-v4-flash",
  "deepseek-v4-reasoner-flash",
  "deepseek-v4-pro",
  "deepseek-v4-reasoner-pro",
  "deepseek-v4-vision",
  "deepseek-v4-vision-reasoner"
];

const GROUPS = ["快速", "快速-深度", "专家", "专家-深度", "v4 Flash", "v4 Flash-深度", "v4 Pro", "v4 Pro-深度", "识图", "识图-深度"];

export const MODELS: ModelOption[] = BASE.flatMap((b, i) => {
  const base = { ...b, id: NAMES[i], label: GROUPS[i], group: GROUPS[i] };
  if (b.modelType === "vision") return [{ ...base, searchEnabled: false }];
  return [
    { ...base, searchEnabled: false },
    { ...base, id: `${NAMES[i]}-search`, label: `${GROUPS[i]}（联网）`, searchEnabled: true }
  ];
});

export const DEFAULT_MODEL_ID = "deepseek-chat-fast";

export function resolveModel(id: string): ModelOption {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}
