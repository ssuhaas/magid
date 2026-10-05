import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magid · Bid Normalizer",
  description: "Review bid source facts and prepare the Magid Excel template.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
