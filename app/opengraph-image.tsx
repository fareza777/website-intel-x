import { ImageResponse } from "next/og";
export const alt = "CryptoScanora crypto market research terminal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 78px",
          background: "linear-gradient(135deg, #080b15 0%, #111b31 58%, #0b1222 100%)",
          color: "#f3f6ff",
          fontFamily: "Arial",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22, color: "#94baff", fontSize: 26, letterSpacing: 4 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: "#29477d", border: "2px solid #7fa9ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30 }}>↗</div>
          CRYPTOSCANORA
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 700, letterSpacing: -2 }}>Advanced crypto</div>
          <div style={{ fontSize: 68, fontWeight: 700, letterSpacing: -2, color: "#9bbdff" }}>trading intelligence.</div>
          <div style={{ fontSize: 26, color: "#b6c4df", maxWidth: 820 }}>Real market data · multi-timeframe research · transparent risk plans</div>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 20, color: "#8395b7" }}>SPOT RESEARCH TERMINAL&nbsp;&nbsp; / &nbsp;&nbsp;BINANCE PUBLIC DATA&nbsp;&nbsp; / &nbsp;&nbsp;PAPER TRADING</div>
      </div>
    ),
    { ...size },
  );
}
