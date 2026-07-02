import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { queryRows } from "@/lib/db";

export type AicRole = "User" | "Admin" | "Content Manager" | "Research User" | "Read Only";

export type CurrentAppUser = {
  clerkUserId: string;
  email: string;
  name: string;
  role: AicRole;
};

export type AppUserRow = {
  clerkUserId: string;
  email: string;
  name: string;
  role: AicRole;
  lastSeenAt: string | null;
  updatedAt: string | null;
};

class ForbiddenError extends Error {
  constructor(message = "Administrator role is required.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

const BOOTSTRAP_ADMIN_EMAILS = ["michael@ammonsfarm.org"];

type UserRoleRow = {
  role: string | null;
};

type UserListRow = {
  clerk_user_id: string | null;
  email: string;
  name: string | null;
  role: string | null;
  last_seen_at: string | null;
  updated_at: string | null;
};

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeAicRole(value: unknown): AicRole | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "admin" || normalized === "administrator") {
    return "Admin";
  }

  if (normalized === "user") {
    return "User";
  }

  if (normalized === "content manager" || normalized === "content_manager" || normalized === "contentmanager") {
    return "Content Manager";
  }

  if (normalized === "research user" || normalized === "research_user" || normalized === "researcher") {
    return "Research User";
  }

  if (normalized === "read only" || normalized === "read_only" || normalized === "readonly" || normalized === "viewer") {
    return "Read Only";
  }

  return null;
}

function configuredAdminEmails() {
  const envEmails = (process.env.AIC_ADMIN_EMAILS ?? process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);

  return [...new Set([...BOOTSTRAP_ADMIN_EMAILS, ...envEmails])];
}

function isBootstrapAdminEmail(email: string) {
  return configuredAdminEmails().includes(normalizeEmail(email));
}

async function getCurrentIdentity() {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }

  const user = await currentUser();
  const primaryEmail =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)?.emailAddress ??
    user?.emailAddresses[0]?.emailAddress ??
    "";
  const email = normalizeEmail(primaryEmail);

  if (!email) {
    throw new Error("Signed-in user has no email address.");
  }

  return {
    clerkUserId: userId,
    email,
    name: user?.fullName ?? [user?.firstName, user?.lastName].filter(Boolean).join(" ") ?? "",
  };
}

async function upsertCurrentRole(identity: { clerkUserId: string; email: string; name: string }) {
  await queryRows(
    `
      insert into aic_users(clerk_user_id, email, name, last_seen_at, updated_at)
      values ($1, $2, $3, now(), now())
      on conflict (clerk_user_id) do update
      set email = excluded.email,
          name = excluded.name,
          last_seen_at = now(),
          updated_at = now()
    `,
    [identity.clerkUserId, identity.email, identity.name],
  );

  if (isBootstrapAdminEmail(identity.email)) {
    await queryRows(
      `
        insert into aic_user_roles(email, role, assigned_by, updated_at)
        values ($1, 'Admin', 'bootstrap', now())
        on conflict (email) do update
        set role = 'Admin',
            assigned_by = 'bootstrap',
            updated_at = now()
      `,
      [identity.email],
    );
  } else {
    await queryRows(
      `
        insert into aic_user_roles(email, role, assigned_by)
        values ($1, 'User', 'default')
        on conflict (email) do nothing
      `,
      [identity.email],
    );
  }

  const rows = await queryRows<UserRoleRow>(
    "select role from aic_user_roles where email = $1 limit 1",
    [identity.email],
  );
  const dbRole = normalizeAicRole(rows[0]?.role) ?? "User";
  return isBootstrapAdminEmail(identity.email) ? "Admin" : dbRole;
}

export async function ensureCurrentAppUser(): Promise<CurrentAppUser | null> {
  const identity = await getCurrentIdentity();
  if (!identity) {
    return null;
  }

  const role = await upsertCurrentRole(identity);
  return { ...identity, role };
}

export async function requireSignedInAppUser(): Promise<CurrentAppUser> {
  await auth.protect();
  const appUser = await ensureCurrentAppUser();
  if (!appUser) {
    redirect("/login");
  }

  return appUser;
}

export async function getCurrentUserRole(): Promise<AicRole> {
  const identity = await getCurrentIdentity();
  if (!identity) {
    return "User";
  }

  if (isBootstrapAdminEmail(identity.email)) {
    await upsertCurrentRole(identity);
    return "Admin";
  }

  return upsertCurrentRole(identity);
}

export function isAdministratorRole(role: AicRole) {
  return role === "Admin";
}

export function isContentManagerRole(role: AicRole) {
  return role === "Admin" || role === "Content Manager";
}

export function isResearchUserRole(role: AicRole) {
  return role === "Admin" || role === "Content Manager" || role === "Research User" || role === "User";
}

export async function isCurrentUserAdministrator() {
  return isAdministratorRole(await getCurrentUserRole());
}

export async function isCurrentUserContentManager() {
  return isContentManagerRole(await getCurrentUserRole());
}

export async function requireAdministrator(redirectTo = "/podcast") {
  if (!(await isCurrentUserAdministrator())) {
    redirect(redirectTo);
  }
}

export async function requireContentManagerOrAdmin(redirectTo = "/overview") {
  const appUser = await requireSignedInAppUser();
  if (!isContentManagerRole(appUser.role)) {
    redirect(redirectTo);
  }

  return appUser;
}

export async function requireContentManager(redirectTo = "/overview") {
  return requireContentManagerOrAdmin(redirectTo);
}

export async function requireResearchUser(redirectTo = "/overview") {
  const appUser = await requireSignedInAppUser();
  if (!isResearchUserRole(appUser.role)) {
    redirect(redirectTo);
  }

  return appUser;
}

export async function requireAdminApiUser(): Promise<CurrentAppUser> {
  const appUser = await requireSignedInAppUser();
  if (!isAdministratorRole(appUser.role)) {
    throw new ForbiddenError();
  }

  return appUser;
}

export async function requireContentManagerApiUser(): Promise<CurrentAppUser> {
  const appUser = await requireSignedInAppUser();
  if (!isContentManagerRole(appUser.role)) {
    throw new ForbiddenError("Content Manager role is required.");
  }

  return appUser;
}

export function isForbiddenError(error: unknown) {
  return error instanceof ForbiddenError;
}

export async function listAppUsers(): Promise<AppUserRow[]> {
  const rows = await queryRows<UserListRow>(
    `
      select
        u.clerk_user_id,
        coalesce(u.email, r.email) as email,
        coalesce(u.name, '') as name,
        coalesce(r.role, 'User') as role,
        u.last_seen_at::text,
        coalesce(r.updated_at, u.updated_at)::text as updated_at
      from aic_user_roles r
      full outer join aic_users u on u.email = r.email
      order by
        case when coalesce(r.role, 'User') = 'Admin' then 0 else 1 end,
        coalesce(u.email, r.email)
    `,
  );

  return rows.map((row) => ({
    clerkUserId: row.clerk_user_id ?? "",
    email: row.email,
    name: row.name ?? "",
    role: normalizeAicRole(row.role) ?? "User",
    lastSeenAt: row.last_seen_at,
    updatedAt: row.updated_at,
  }));
}

export async function assignUserRole({
  email,
  role,
  assignedBy,
}: {
  email: string;
  role: AicRole;
  assignedBy: string;
}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Enter a valid email address.");
  }

  if (isBootstrapAdminEmail(normalizedEmail) && role !== "Admin") {
    throw new Error("The bootstrap admin account must remain Admin.");
  }

  const rows = await queryRows<UserListRow>(
    `
      insert into aic_user_roles(email, role, assigned_by, updated_at)
      values ($1, $2, $3, now())
      on conflict (email) do update
      set role = excluded.role,
          assigned_by = excluded.assigned_by,
          updated_at = now()
      returning
        null::text as clerk_user_id,
        email,
        ''::text as name,
        role,
        null::text as last_seen_at,
        updated_at::text
    `,
    [normalizedEmail, role, assignedBy],
  );

  return {
    clerkUserId: rows[0]?.clerk_user_id ?? "",
    email: rows[0]?.email ?? normalizedEmail,
    name: rows[0]?.name ?? "",
    role: normalizeAicRole(rows[0]?.role) ?? role,
    lastSeenAt: rows[0]?.last_seen_at ?? null,
    updatedAt: rows[0]?.updated_at ?? null,
  };
}
