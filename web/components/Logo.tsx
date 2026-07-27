import type { CSSProperties } from "react";

/**
 * HFOS logo, drawn as inline SVG so it is crisp at any size and adapts to the
 * surface: the house outline + wordmark use currentColor (navy on light, white
 * on dark/brand fields), while the rising bars and arrow keep the fixed
 * growth-green gradient from the brand identity.
 */
export function LogoMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="hfosGrowth" x1="20" y1="54" x2="48" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1f7a4d" />
          <stop offset="1" stopColor="#7ac043" />
        </linearGradient>
      </defs>
      {/* house / building outline (adapts to text color) */}
      <path d="M13 54 L13 23 L33 11 M13 54 L53 54 M53 54 L53 29"
        stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* rising bars */}
      <rect x="20" y="42" width="6" height="12" rx="1.6" fill="url(#hfosGrowth)" />
      <rect x="29" y="34" width="6" height="20" rx="1.6" fill="url(#hfosGrowth)" />
      <rect x="38" y="28" width="6" height="26" rx="1.6" fill="url(#hfosGrowth)" />
      {/* growth arrow breaking through the roof */}
      <path d="M18 47 C 27 45 33 37 41 28 S 50 17 53 13"
        stroke="url(#hfosGrowth)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M53 13 L45 13 M53 13 L53 21"
        stroke="url(#hfosGrowth)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Logo({
  size = 34,
  wordmark = true,
  tagline = false,
  className = "",
  style,
}: {
  size?: number;
  wordmark?: boolean;
  tagline?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`} style={style}>
      <LogoMark size={size} />
      {wordmark && (
        <span className="leading-none">
          <span className="block font-serif font-bold tracking-tight" style={{ fontSize: size * 0.72 }}>HFOS</span>
          {tagline && (
            <span className="mt-1 block text-[0.6rem] font-medium uppercase tracking-[0.18em] opacity-70">
              Household Financial OS
            </span>
          )}
        </span>
      )}
    </span>
  );
}
