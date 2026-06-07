import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { TopRail } from "@/components/top-rail";

export default async function PrivateLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { userId } = await auth();

  if (!userId) {
    redirect("/login");
  }

  return (
    <>
      <TopRail variant="public" />
      <main className="public-shell">{children}</main>
    </>
  );
}
