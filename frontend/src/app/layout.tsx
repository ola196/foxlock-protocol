import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Soroban Milestone Escrow",
  description:
    "Trustless milestone-based escrow on Stellar. Built for GrantFox contributor reward disbursement.",
  openGraph: {
    title: "Soroban Milestone Escrow",
    description: "Trustless, transparent contributor payments on Stellar.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-950 text-gray-50 min-h-screen`}
      >
        <Header />
        <main className="container mx-auto px-4 py-8 max-w-6xl">{children}</main>
      </body>
    </html>
  );
}
