import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted (via @fontsource) so the app builds and runs offline.
const pixel = localFont({
  variable: "--font-pixel",
  src: [
    { path: "../node_modules/@fontsource/pixelify-sans/files/pixelify-sans-latin-400-normal.woff2", weight: "400" },
    { path: "../node_modules/@fontsource/pixelify-sans/files/pixelify-sans-latin-500-normal.woff2", weight: "500" },
    { path: "../node_modules/@fontsource/pixelify-sans/files/pixelify-sans-latin-600-normal.woff2", weight: "600" },
    { path: "../node_modules/@fontsource/pixelify-sans/files/pixelify-sans-latin-700-normal.woff2", weight: "700" },
  ],
});
const mono = localFont({
  variable: "--font-code",
  src: [
    { path: "../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2", weight: "400" },
    { path: "../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2", weight: "500" },
  ],
});

export const metadata: Metadata = {
  title: "Re:Spawn — bring dead software back to life",
  description:
    "A graph-powered agent that diagnoses broken npm projects, finds verified migration paths in FalkorDB, and brings them back to life.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${pixel.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
