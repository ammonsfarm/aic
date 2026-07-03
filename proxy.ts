import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { getStrapiPageBySlug } from "@/lib/strapi";

const isApiRoute = createRouteMatcher(["/api(.*)"]);
const isPublicApiRoute = createRouteMatcher(["/api/revalidate/strapi"]);
const isPublicPageRoute = createRouteMatcher([
  "/",
  "/about-pastor-wood(.*)",
  "/radio(.*)",
  "/bible-study(.*)",
  "/written-resources(.*)",
  "/writings(.*)",
  "/episodes(.*)",
  "/contact(.*)",
  "/donate(.*)",
  "/donor-dashboard(.*)",
  "/endorsements(.*)",
  "/board-members(.*)",
  "/privacy(.*)",
  "/privacy-terms-conditions(.*)",
  "/reading-plan(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  const { userId } = await auth();
  const singleSegmentSlug = request.nextUrl.pathname.match(/^\/([^/]+)\/?$/)?.[1];

  if (isApiRoute(request)) {
    if (isPublicApiRoute(request) || userId) {
      return;
    }

    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  if (isPublicPageRoute(request)) {
    return;
  }

  if (singleSegmentSlug) {
    const cmsPage = await getStrapiPageBySlug(singleSegmentSlug);
    if (cmsPage?.active) {
      return;
    }
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
