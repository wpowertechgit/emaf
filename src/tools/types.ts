import type { ToolContext } from "../context";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: readonly string[];
  };
}

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;

export interface Tool {
  definition: ToolDefinition;
  handler: ToolHandler;
}
