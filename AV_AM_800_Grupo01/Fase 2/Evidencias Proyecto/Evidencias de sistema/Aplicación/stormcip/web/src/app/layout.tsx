import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

export const metadata: Metadata = {
  title: "StormCIP",
  description: "Monitoreo IoT de procesos de limpieza CIP",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      {/* Los colores salen de styles/tokens.css via globals.css. */}
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
