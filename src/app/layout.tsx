import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Mark } from "@/components/icons";
import RouteFocus from "@/components/RouteFocus";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Fair Trial", template: "%s · Fair Trial" },
  description: "Is your skincare working? A fair split-face trial on your own face, measured with YouCam's skin analysis.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0e0d" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-bg text-ink">
        <a
          href="#content"
          data-skip-link
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-surface focus:px-4 focus:py-3 focus:text-base focus:font-semibold focus:text-ink focus:shadow-lg"
        >
          Skip to content
        </a>
        <header data-app-bar className="border-b border-line bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/70">
          <div className="mx-auto flex h-14 w-full max-w-md items-center px-4">
            <Link href="/" className="-ml-2 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-lg font-semibold tracking-tight">
              <Mark size={26} className="text-ink" />
              <span>Fair Trial</span>
            </Link>
          </div>
        </header>
        <div id="content" tabIndex={-1} className="flex flex-1 flex-col">
          {children}
        </div>
        <RouteFocus />
      </body>
    </html>
  );
}
