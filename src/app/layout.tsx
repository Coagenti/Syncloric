import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Syncloric",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Syncloric", statusBarStyle: "black-translucent" },
  icons: { apple: "/brand/apple-touch-icon.png", icon: [{ url: "/favicon.ico" }, { url: "/brand/favicon-32.png", type: "image/png", sizes: "32x32" }] },
  description:
    "Diario calorie self-hosted con import automatico da norish (docs/ARCHITECTURE.md)",
};

export const viewport: Viewport = {
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0e17",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <script dangerouslySetInnerHTML={{ __html: `(()=>{let saved;try{saved=localStorage.getItem('syncloric.reduce-motion')}catch{}document.documentElement.dataset.motion=(saved==='true'||(saved!=='false'&&matchMedia('(prefers-reduced-motion: reduce)').matches))?'reduce':'full'})()` }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
