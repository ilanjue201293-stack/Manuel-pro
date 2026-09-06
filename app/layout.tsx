import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./enhancements.css";
import "./mobile-keyboard.css";
import "./comms-v2.css";

export const metadata: Metadata = {
  title: "Manuel Pro",
  description: "Messagerie privée",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Manuel Pro",
    statusBarStyle: "black-translucent",
  },
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#101114",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}
