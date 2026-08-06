import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({ subsets: ["latin", "vietnamese"] });

export const metadata: Metadata = {
  title: "AI Review Hợp đồng | Saint-Gobain Việt Nam",
  description:
    "Trợ lý AI hỗ trợ phòng Mua hàng rà soát hợp đồng trước Legal review và đồng bộ Econtract",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className={inter.className}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
