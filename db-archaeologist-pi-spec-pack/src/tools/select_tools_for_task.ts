import { selectToolsForTask as svc } from "../services/selector.js";

export type SelectToolsInput = { task: string; known_params?: Record<string, unknown> };

export function selectToolsForTask(args: SelectToolsInput) {
  if (!args || typeof args.task !== "string" || args.task.trim() === "") {
    throw new Error("select_tools_for_task: task is required");
  }
  return svc(args.task, args.known_params ?? {});
}