import type { Metadata } from "next";
import "./globals.css";
import { themeInitScript } from "@/components/theme";

export const metadata: Metadata = {
  title: "HFOS — Household Financial Operating System",
  description: "A secure, explainable personal-CFO platform for serious households.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Set theme/density before paint to avoid a flash of the wrong theme. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
