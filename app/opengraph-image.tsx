import { ImageResponse } from "next/og";

import { SITE_TAGLINE } from "@/lib/site";

/**
 * The card shown when a PlaywrightGen link is shared in Slack, LinkedIn,
 * WeChat or a message. Without it a shared link was a bare URL, which is the
 * first impression a teammate gets when someone says "look at this".
 */
export const alt = "PlaywrightGen — Know what to test. Know whether to ship.";
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
          padding: "64px 72px",
          background: "linear-gradient(135deg, #020617 0%, #0f172a 60%, #083344 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "white",
              color: "#020617",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 26,
              fontWeight: 800,
            }}
          >
            PG
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 34, fontWeight: 700 }}>PlaywrightGen</div>
            <div style={{ fontSize: 20, color: "#67e8f9", letterSpacing: 2 }}>{SITE_TAGLINE.toUpperCase()}</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>Know what to test.</div>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, color: "#67e8f9" }}>
            Know whether to ship.
          </div>
        </div>

        <div style={{ display: "flex", gap: 16 }}>
          {["Tests from the real page", "Reviewed and approved", "Proof from your CI"].map((label) => (
            <div
              key={label}
              style={{
                display: "flex",
                padding: "12px 22px",
                borderRadius: 999,
                border: "1px solid rgba(103, 232, 249, 0.35)",
                background: "rgba(103, 232, 249, 0.08)",
                fontSize: 24,
                color: "#e2e8f0",
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
