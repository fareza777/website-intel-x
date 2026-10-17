/** Pure key list so client code can read models without loading the archive downloader. */
export const DERIVATIVE_KEYS = ["oiChange1d", "oiChange7d", "longShortRatio", "topTraderRatio", "takerRatio", "premium3d"] as const;
export type DerivativeKey = (typeof DERIVATIVE_KEYS)[number];
export type DerivativeFeatures = Record<DerivativeKey, number | null>;
