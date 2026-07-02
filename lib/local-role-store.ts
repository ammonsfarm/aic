import "server-only";

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AicRole, AppUserRow } from "@/lib/rbac";

const LOCAL_ROLE_STORE = path.join(process.cwd(), ".local-aic-user-roles.json");
const LOCAL_ASSIGNED_BY = "local admin override";

type LocalRoleEntry = {
  email: string;
  role: AicRole;
  updatedAt: string | null;
  assignedBy: string;
};

function isLocalRoleStoreEnabled() {
  return process.env.NODE_ENV !== "production";
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeRole(value: unknown): AicRole | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "admin" || normalized === "administrator") {
    return "Admin";
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

  if (normalized === "user") {
    return "User";
  }

  return null;
}

async function readLocalRoleEntries(): Promise<LocalRoleEntry[]> {
  if (!isLocalRoleStoreEnabled()) {
    return [];
  }

  try {
    const raw = await readFile(LOCAL_ROLE_STORE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const record = item as Partial<LocalRoleEntry>;
      const email = typeof record.email === "string" ? normalizeEmail(record.email) : "";
      const role = normalizeRole(record.role);
      if (!email || !role) {
        return [];
      }

      return [{
        email,
        role,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
        assignedBy: typeof record.assignedBy === "string" ? record.assignedBy : LOCAL_ASSIGNED_BY,
      }];
    });
  } catch {
    return [];
  }
}

async function writeLocalRoleEntries(entries: LocalRoleEntry[]) {
  if (!isLocalRoleStoreEnabled()) {
    return;
  }

  await writeFile(LOCAL_ROLE_STORE, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

export async function getLocalUserRole(email: string): Promise<AicRole | null> {
  const normalizedEmail = normalizeEmail(email);
  const entry = (await readLocalRoleEntries()).find((item) => item.email === normalizedEmail);
  return entry?.role ?? null;
}

export async function listLocalAppUsers(): Promise<AppUserRow[]> {
  return (await readLocalRoleEntries()).map((entry) => ({
    clerkUserId: "",
    email: entry.email,
    name: "Local role override",
    role: entry.role,
    lastSeenAt: null,
    updatedAt: entry.updatedAt,
  }));
}

export async function assignLocalUserRole({ email, role }: { email: string; role: AicRole }): Promise<AppUserRow> {
  const normalizedEmail = normalizeEmail(email);
  const entries = await readLocalRoleEntries();
  const now = new Date().toISOString();
  const nextEntry: LocalRoleEntry = {
    email: normalizedEmail,
    role,
    updatedAt: now,
    assignedBy: LOCAL_ASSIGNED_BY,
  };
  const nextEntries = [nextEntry, ...entries.filter((entry) => entry.email !== normalizedEmail)];
  await writeLocalRoleEntries(nextEntries);

  return {
    clerkUserId: "",
    email: normalizedEmail,
    name: "Local role override",
    role,
    lastSeenAt: null,
    updatedAt: now,
  };
}
