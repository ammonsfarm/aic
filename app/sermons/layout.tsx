import { privateConsoleMetadata } from "@/lib/private-console-metadata";

export const metadata = privateConsoleMetadata;

export default function SermonsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
