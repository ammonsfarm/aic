import "server-only";

import { requireResearchUser } from "@/lib/rbac";

export async function requireResearchConsoleUser() {
  return requireResearchUser();
}
