import { describe, expect, it } from "vitest";

import { isKnownPrivatePath } from "@/lib/route-access";

describe("signed-out route access", () => {
  it("auth-gates only known private route families", () => {
    expect(isKnownPrivatePath("/admin/settings")).toBe(true);
    expect(isKnownPrivatePath("/console/episodes/123")).toBe(true);
    expect(isKnownPrivatePath("/episodes/123")).toBe(true);
    expect(isKnownPrivatePath("/unknown-page")).toBe(false);
    expect(isKnownPrivatePath("/unknown-page/deeper/path")).toBe(false);
  });
});
