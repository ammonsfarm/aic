import { TopRail } from "@/components/top-rail";
import { requireSignedInAppUser } from "@/lib/rbac";

export default async function PrivateLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const appUser = await requireSignedInAppUser();

  return (
    <>
      <TopRail variant="private" isAdmin={appUser.role === "Admin"} role={appUser.role} />
      <main className="public-shell">{children}</main>
    </>
  );
}
