import "server-only";

import { redirect } from "next/navigation";

import { canUseInternalReadConsole, canUseResearchConsole } from "@/lib/navigation";
import { requireSignedInAppUser, roleLandingPath } from "@/lib/rbac";

export async function requireInternalReadConsoleUser() {
  const appUser = await requireSignedInAppUser();
  if (!canUseInternalReadConsole(appUser.role)) {
    redirect(roleLandingPath(appUser.role));
  }

  return appUser;
}

export async function requireResearchConsoleUser() {
  const appUser = await requireSignedInAppUser();
  if (!canUseResearchConsole(appUser.role)) {
    redirect(roleLandingPath(appUser.role));
  }

  return appUser;
}
