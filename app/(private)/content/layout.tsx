import { requireContentManagerOrAdmin } from "@/lib/rbac";

export default async function ContentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireContentManagerOrAdmin();
  return children;
}
