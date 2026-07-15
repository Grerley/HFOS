import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HFOS — Household Financial Operating System",
  description: "A secure, explainable personal-CFO platform for serious households.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
