import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "CareVoice Relay", description: "Private care updates and clinician review" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>
    <header className="border-b border-[#cfe2dd] bg-white"><div className="shell flex min-h-18 items-center justify-between gap-3 py-3 sm:gap-4 sm:py-4">
      <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#0d766e] text-xl text-white">◌</span><span><strong className="block text-lg leading-5">CareVoice Relay</strong><span className="text-xs text-[#5d7078]">Private updates. Focused review.</span></span></div>
      <span className="hidden text-right text-sm font-semibold text-[#49656a] sm:block">Secure care communication</span>
    </div><div className="service-banner" role="note"><div className="shell"><strong>Not an emergency service.</strong> Contact local emergency services or the assigned care team for urgent help. <strong className="ml-2">Prototype only.</strong> Do not use with real health information without clinical and privacy approval.</div></div></header>
    <main>{children}</main>
  </body></html>;
}
