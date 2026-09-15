import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

const siteUrl = "https://anadayo.github.io/tag-tokyo/";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "TAG TOKYO | 東京を歩くほど、出会いと自分が育つ。",
  description: "現在地を公開せず、東京でのすれ違い、EXPによるプロフィール成長、無料TAG SPOTを楽しめるマッチングPWA。",
  applicationName: "TAG TOKYO",
  manifest: "/tag-tokyo/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "TAG TOKYO" },
  openGraph: {
    title: "TAG TOKYO",
    description: "東京を歩くほど、出会いと自分が育つ。",
    url: siteUrl,
    siteName: "TAG TOKYO",
    images: [{ url: "/tag-tokyo/ogp.png", width: 1200, height: 630 }],
    locale: "ja_JP",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#fffdfb",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  return (
    <html lang="ja">
      <body>
        {children}
        {gaId && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="afterInteractive" />
            <Script id="ga4" strategy="afterInteractive">{`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              window.gtag = gtag;
              gtag('js', new Date());
              gtag('config', '${gaId}', { content_group: 'tag_tokyo' });
            `}</Script>
          </>
        )}
      </body>
    </html>
  );
}
