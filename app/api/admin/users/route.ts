import { NextRequest, NextResponse } from "next/server";

import {
  assignUserRole,
  isForbiddenError,
  listAppUsers,
  normalizeAicRole,
  requireAdminApiUser,
} from "@/lib/rbac";

type UserRolePayload = {
  email?: unknown;
  role?: unknown;
};

export async function GET() {
  try {
    await requireAdminApiUser();
    return NextResponse.json({ users: await listAppUsers() });
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Administrator role is required." }, { status: 403 });
    }

    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminApiUser();
    const payload = (await request.json().catch(() => ({}))) as UserRolePayload;
    const email = typeof payload.email === "string" ? payload.email : "";
    const role = normalizeAicRole(payload.role);

    if (!role) {
      return NextResponse.json({ error: "Choose User, Content Manager, Research User, Read Only, or Admin." }, { status: 400 });
    }

    const user = await assignUserRole({ email, role, assignedBy: admin.email });
    return NextResponse.json({ user, users: await listAppUsers() });
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Administrator role is required." }, { status: 403 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "User role update failed." }, { status: 400 });
  }
}
