import summary from "./model-summary.json";
import type { ModelSummary } from "./model";

/** Weight-free description of the bundled model for the browser. */
export const MODEL_SUMMARY = summary as unknown as ModelSummary;
