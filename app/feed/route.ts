import { buildPublicPostsFeed, PUBLIC_FEED_MAX_ITEMS } from "@/lib/public-feed";
import { listLatestPublishedPostsResult } from "@/lib/strapi-structured-public";

export const runtime = "nodejs";
export const revalidate = 300;

const responseHeaders = {
  "Content-Type": "application/rss+xml; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function unavailableFeed() {
  return new Response(buildPublicPostsFeed([]), {
    status: 503,
    headers: {
      ...responseHeaders,
      "Cache-Control": "no-store",
      "Retry-After": "300",
    },
  });
}

export async function GET() {
  try {
    const result = await listLatestPublishedPostsResult(PUBLIC_FEED_MAX_ITEMS);
    if (!result.available) return unavailableFeed();
    return new Response(buildPublicPostsFeed(result.items), {
      headers: {
        ...responseHeaders,
        "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("Public RSS feed generation failed.", error);
    return unavailableFeed();
  }
}
