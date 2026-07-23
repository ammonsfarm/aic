import { privateConsoleMetadata } from "@/lib/private-console-metadata";

export const metadata = privateConsoleMetadata;

export default function PreviewLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
