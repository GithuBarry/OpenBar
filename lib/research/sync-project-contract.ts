export const syncProjectProperties = {
  action: { type: "string", enum: ["inspect", "review_pull", "apply_pull", "cancel_pull"], description: "inspect reads status. review_pull checkpoints saved local files and prepares an isolated merge. apply_pull applies reviewed whole-file resolutions. cancel_pull removes the review checkout." },
  refresh: { type: "boolean", description: "Fetch Git before inspecting status." },
  token: { type: "string", description: "Exact review token returned by review_pull." },
  resolutions: { type: "array", items: { type: "object", properties: { path: { type: "string" }, choice: { type: "string", enum: ["local", "remote", "merged"] }, text: { type: "string", maxLength: 1000000, description: "Complete merged file contents when choice=merged." } }, required: ["path", "choice"], additionalProperties: false } },
} as const;
