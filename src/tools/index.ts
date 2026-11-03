import { batchScrapeTool } from "./batch-scrape";
import { crawlTool } from "./crawl";
import { mapTool } from "./map";
import { priorArtTool } from "./prior-art";
import { researchTool } from "./research";
import { scrapeTool } from "./scrape";
import { searchTool } from "./search";
import type { Tool, ToolDefinition, ToolHandler } from "./types";

const TOOLS: Tool[] = [researchTool, priorArtTool, scrapeTool, batchScrapeTool, mapTool, crawlTool, searchTool];

export const TOOL_DEFINITIONS: ToolDefinition[] = TOOLS.map((t) => t.definition);

export const TOOL_HANDLERS: Record<string, ToolHandler> = Object.fromEntries(
  TOOLS.map((t) => [t.definition.name, t.handler]),
);
