import bundled from "./model.json";
import type { CalibrationModel } from "./model";

/** Full frozen model (weights and trees). Server-side only: the client loads model-summary.json. */
export const BUNDLED_MODEL = bundled as unknown as CalibrationModel;
