import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./admin.css";

export const metadata: Metadata = {
  title: { default: "Админ-панель", template: "%s · Админ-панель" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#07070d",
  colorScheme: "dark",
};

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return <div className="adm-root">{children}</div>;
}
