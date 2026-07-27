import type { CSSProperties } from "react";

// The official HFOS artwork, prepared as transparent PNGs:
//   logo-full.png       full-colour lockup  (for light surfaces)
//   logo-full-dark.png  white lockup        (for dark / navy surfaces)
//   logo-mark.png       icon only           (compact spots, favicons)
// `variant="auto"` shows the colour lockup in light theme and the white
// lockup in dark theme (data-theme="dark"); pass "light"/"dark" to force one.
const ALT = "HFOS — Household Financial OS";

export function LogoMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo-mark.png" alt="HFOS" width={size} height={size} className={className} style={{ height: size, width: size, objectFit: "contain" }} />;
}

export default function Logo({
  size = 36,
  variant = "auto",
  markOnly = false,
  className = "",
  style,
}: {
  size?: number;
  variant?: "auto" | "light" | "dark";
  markOnly?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  if (markOnly) return <LogoMark size={size} className={className} />;
  const imgStyle: CSSProperties = { height: size, width: "auto", ...style };
  if (variant === "light") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/logo-full.png" alt={ALT} className={className} style={imgStyle} />;
  }
  if (variant === "dark") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/logo-full-dark.png" alt={ALT} className={className} style={imgStyle} />;
  }
  return (
    <span className={`inline-flex ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-full.png" alt={ALT} className="block dark:hidden" style={imgStyle} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-full-dark.png" alt="" aria-hidden className="hidden dark:block" style={imgStyle} />
    </span>
  );
}
