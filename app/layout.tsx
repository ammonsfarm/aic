import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { isPublicIndexingEnabled } from "@/lib/public-seo";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PASTORWOOD_PUBLIC_URL || "https://www.pastorwood.org"),
  title: {
    default: "Abiding in Christ with Jim Wood",
    template: "%s | Abiding in Christ",
  },
  description: "Bible teaching, radio broadcasts, devotionals, and ministry resources from Pastor Jim Wood.",
  applicationName: "Abiding in Christ",
  robots: isPublicIndexingEnabled()
    ? { index: true, follow: true }
    : { index: false, follow: false, noarchive: true, nosnippet: true },
  manifest: "/manifest.webmanifest",
  alternates: {
    canonical: "/",
    types: { "application/rss+xml": "/feed/" },
  },
  icons: { icon: "/images/pastorwood/deep-forest-logo-transparent.png" },
  openGraph: {
    type: "website",
    siteName: "Abiding in Christ with Jim Wood",
    title: "Abiding in Christ with Jim Wood",
    description: "Bible teaching, radio broadcasts, devotionals, and ministry resources from Pastor Jim Wood.",
    url: "/",
    images: [{ url: "/images/pastorwood/smoky-mountain-church.png", alt: "Abiding in Christ" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable} data-scroll-behavior="smooth">
      <body>
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}
