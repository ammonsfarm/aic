import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { TopRail } from "@/components/top-rail";
import { consoleNav } from "@/lib/navigation";

export default async function PrivateLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { userId } = await auth();

  if (!userId) {
    redirect("/");
  }

  return (
    <>
      <TopRail variant="private" />
      <div className="console-shell">
        <aside className="console-sidebar" aria-label="Console sections">
          <p className="eyebrow">Private console</p>
          <div className="sidebar-list">
            {consoleNav.map((item) => (
              <a key={item.href} href={item.href}>
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </a>
            ))}
          </div>
        </aside>
        <main className="console-main">{children}</main>
      </div>
    </>
  );
}
