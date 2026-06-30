import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isApiRoute = createRouteMatcher(["/api(.*)"]);
const isPublicPageRoute = createRouteMatcher(["/reading-plan(.*)", "/privacy(.*)", "/writings(.*)"]);
const pastorWoodHosts = new Set(["pastorwood.ammonsfarm.org", "www.pastorwood.ammonsfarm.org"]);

function isPastorWoodHost(request: Request) {
  const host = request.headers.get("host")?.split(":")[0].toLowerCase();
  return Boolean(host && pastorWoodHosts.has(host));
}

export default clerkMiddleware(async (auth, request) => {
  if (!isApiRoute(request) && isPastorWoodHost(request)) {
    return;
  }

  const { userId } = await auth();

  if (isApiRoute(request)) {
    if (userId) {
      return;
    }

    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  if (isPublicPageRoute(request)) {
    return;
  }

  if (userId) {
    return;
  }

  const signInUrl = new URL("/login", request.url);
  signInUrl.searchParams.set("redirect_url", `${request.nextUrl.pathname}${request.nextUrl.search}`);

  return NextResponse.redirect(signInUrl);
});

export const config = {
  matcher: [
    "/((?!login(?:/|$)|_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
