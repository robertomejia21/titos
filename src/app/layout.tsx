import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono, Poppins } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Titos | Almacén Central",
  description: "Sistema de almacén y distribución a sucursales — Mercados Titos",
  icons: {
    icon: "/media/favicon.png",
    shortcut: "/media/favicon.png",
    apple: "/media/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} ${poppins.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
        <Analytics />
        <Script id="davinci-capture-loader" strategy="afterInteractive">{`if(window.parent!==window){var s=document.createElement('script');s.src='/davinci-capture.v1.js';s.async=true;document.head.appendChild(s);}`}</Script>
      </body>
    </html>
  );
}
