import { z } from "zod";
import { failResult, okResult, type OperationResult } from "./operation-result";

export type JsonSchemaObject = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
};

export function commandJsonSchema(input: z.ZodType): JsonSchemaObject {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(input, { io: "input", target: "draft-07" });
  return schema as JsonSchemaObject;
}

export function commandJsonSchemas<T extends Record<string, z.ZodType>>(inputs: T): { [K in keyof T]: JsonSchemaObject } {
  return Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, commandJsonSchema(input)])) as { [K in keyof T]: JsonSchemaObject };
}

/** Validate the complete input before a transport invokes its stateful host. */
export function parseCommandInput(input: z.ZodType<Record<string, unknown>>, value: unknown, browser = false): OperationResult<Record<string, unknown>> {
  if (browser) {
    if (value == null) value = {};
    if (typeof value === "string") {
      try { value = JSON.parse(value); }
      catch { return failResult("invalid_arguments", "Tool arguments must be a JSON object.", false); }
    }
  }
  const parsed = input.safeParse(value);
  if (!parsed.success) return failResult("invalid_arguments", parsed.error.issues.map(issue => `${issue.path.join(".") || "arguments"}: ${issue.message}`).join("; "), false);
  return okResult(parsed.data);
}
