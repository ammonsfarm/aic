import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

import { resolvePublicLegacyRedirect } from "@/lib/legacy-redirects";
import { getStrapiPageBySlug } from "@/lib/strapi";
import { isKnownPrivatePath, singleSegmentSlug } from "@/lib/route-access";

const isApiRoute = createRouteMatcher(["/api(.*)"]);
const isPublicApiRoute = createRouteMatcher(["/api/revalidate/strapi", "/api/public/contact", "/api/public/subscriptions(.*)"]);
const isPublicPageRoute = createRouteMatcher([
  "/",
  "/about-pastor-wood(.*)",
  "/abiding-in-christ(.*)",
  "/radio(.*)",
  "/bible-study(.*)",
  "/written-resources(.*)",
  "/writings(.*)",
  "/contact(.*)",
  "/donate(.*)",
  "/donor-dashboard(.*)",
  "/endorsements(.*)",
  "/board-members(.*)",
  "/privacy(.*)",
  "/privacy-terms-conditions(.*)",
  "/unsubscribe(.*)",
  "/feed(.*)",
  "/media(.*)",
  "/wp-content/uploads(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  const { userId } = await auth();
  const cmsSlug = singleSegmentSlug(request.nextUrl.pathname);

  if (isApiRoute(request)) {
    if (isPublicApiRoute(request) || userId) {
      return;
    }

    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const legacyRedirect = await resolvePublicLegacyRedirect(request.nextUrl.pathname);
  if (legacyRedirect) {
    const target = new URL(legacyRedirect.toPath, request.url);
    return NextResponse.redirect(target, legacyRedirect.statusCode);
  }

  if (isPublicPageRoute(request)) {
    return;
  }

  if (userId) {
    return;
  }

  if (isKnownPrivatePath(request.nextUrl.pathname)) {
    return redirectToLogin(request);
  }

  if (cmsSlug) {
    const cmsPage = await getStrapiPageBySlug(cmsSlug);
    if (cmsPage?.active) {
      return;
    }
  }

  // Unknown signed-out paths belong to Next's routing layer so they can render
  // a real 404. Only explicit private route families auth-redirect above.
  return;
});

function redirectToLogin(request: NextRequest) {
  const signInUrl = new URL("/login", request.url);
  signInUrl.searchParams.set("redirect_url", `${request.nextUrl.pathname}${request.nextUrl.search}`);

  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: [
    "/((?!login(?:/|$)|_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
