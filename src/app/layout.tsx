import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/layout/providers";
import { Sidebar } from "@/components/layout/sidebar";
import { AiChatWindow } from "@/components/ai/AiChatWindow";

export const metadata: Metadata = {
  title: "NXT売上管理",
  description: "Amazon商品別売上管理ダッシュボード",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        <Providers>
          <Sidebar />
          <main className="ml-56 min-h-screen p-6">{children}</main>
          <AiChatWindow />
        </Providers>
      </body>
    </html>
  );
}
