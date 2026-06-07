import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export type AicRole = "Administrator" | "User";

type MetadataRecord = {
  role?: unknown;
  roles?: unknown;
};

function normalizeRole(value: unknown): AicRole | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "administrator" || normalized === "admin") {
    return "Administrator";
  }

  if (normalized === "user") {
    return "User";
  }

  return null;
}

function roleFromMetadata(metadata: unknown): AicRole | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const record = metadata as MetadataRecord;
  const directRole = normalizeRole(record.role);

  if (directRole) {
    return directRole;
  }

  if (Array.isArray(record.roles)) {
    return record.roles.some((role) => normalizeRole(role) === "Administrator") ? "Administrator" : null;
  }

  return null;
}

function configuredAdminEmails() {
  return (process.env.AIC_ADMIN_EMAILS ?? process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function getCurrentUserRole(): Promise<AicRole> {
  const { userId } = await auth();

  if (!userId) {
    return "User";
  }

  const user = await currentUser();
  const userWithUnsafeMetadata = user as typeof user & { unsafeMetadata?: unknown };
  const metadataRole =
    roleFromMetadata(user?.privateMetadata) ??
    roleFromMetadata(user?.publicMetadata) ??
    roleFromMetadata(userWithUnsafeMetadata?.unsafeMetadata);

  if (metadataRole) {
    return metadataRole;
  }

  const adminEmails = configuredAdminEmails();
  const userEmails = user?.emailAddresses.map((email) => email.emailAddress.toLowerCase()) ?? [];

  if (adminEmails.some((email) => userEmails.includes(email))) {
    return "Administrator";
  }

  if (adminEmails.length === 0) {
    return "Administrator";
  }

  return "User";
}

export async function isCurrentUserAdministrator() {
  return (await getCurrentUserRole()) === "Administrator";
}

export async function requireAdministrator(redirectTo = "/podcast") {
  if (!(await isCurrentUserAdministrator())) {
    redirect(redirectTo);
  }
}
