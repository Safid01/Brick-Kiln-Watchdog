import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brick Kiln Watchdog · Greater Dhaka",
  description:
    "Satellite-based brick kiln detection and 1 km buffer-zone compliance dashboard for Greater Dhaka.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
