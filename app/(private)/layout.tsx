import type { Metadata } from "next";

import { TopRail } from "@/components/top-rail";
import { privateConsoleMetadata } from "@/lib/private-console-metadata";
import { requireSignedInAppUser } from "@/lib/rbac";

export const metadata: Metadata = {
  ...privateConsoleMetadata,
  title: "Publishing Console",
};

export default async function PrivateLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const appUser = await requireSignedInAppUser();

  return (
    <>
      <TopRail variant="private" isAdmin={appUser.role === "Admin"} role={appUser.role} />
      <main className="public-shell" id="main-content" tabIndex={-1}>{children}</main>
    </>
  );
}
