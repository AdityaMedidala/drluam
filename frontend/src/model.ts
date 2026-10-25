// The two forecasting models (ADR-001, docs/decisions.md). Simple is the default and the basis of
// every headline number; ML (LightGBM + CQR) is precomputed for January at 09:00 / 09:20 only.
import { createContext, useContext } from "react";

export type Model = "simple" | "ml";
export const MODELS: Model[] = ["simple", "ml"];
export const ML_CUTOFFS = ["09:00", "09:20"];

export const modelLabel = (m: Model) => (m === "ml" ? "ML (LightGBM + CQR)" : "Simple");
/** What the "adjusted" series is called under each model. */
export const adjustedName = (m: Model) => (m === "ml" ? "ML forecast (P50)" : "Bias-corrected forecast");
/** The same name inside a sentence ("the bias-corrected forecast", "the ML forecast (P50)"). */
export const adjustedInline = (m: Model) => (m === "ml" ? "ML forecast (P50)" : "bias-corrected forecast");
export const adjustedShort = (m: Model) => (m === "ml" ? "ML P50" : "Bias-corrected");

export const ModelContext = createContext<Model>("simple");
export const useModel = () => useContext(ModelContext);
