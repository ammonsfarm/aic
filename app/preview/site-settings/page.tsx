import Link from "next/link";
import { notFound } from "next/navigation";

import { PastorWoodSitePreview } from "@/components/pastor-wood-site";
import { getManagedSiteSettings, type ManagedNavigationItem } from "@/lib/strapi-site-settings-management";
import type { StrapiNavigationItem } from "@/lib/strapi-site-settings";
import { requireContentManagerOrAdmin } from "@/lib/rbac";

export const dynamic = "force-dynamic";

function pageHref(item: ManagedNavigationItem) {
  if (!item.pageSlug) return item.url;
  if (item.pageSlug === "home") return "/";
  if (item.pageSlug === "about") return "/about-pastor-wood/";
  return `/${item.pageSlug.replace(/^\/+/, "")}/`;
}

function navigation(items: ManagedNavigationItem[]): StrapiNavigationItem[] {
  return items.map((item) => {
    const href = pageHref(item);
    return {
      id: item.id,
      label: item.label,
      href,
      order: item.order,
      active: item.active,
      external: href.startsWith("http"),
    };
  });
}

export default async function SiteSettingsDraftPreview() {
  await requireContentManagerOrAdmin();
  let settings: Awaited<ReturnType<typeof getManagedSiteSettings>>;
  try {
    settings = await getManagedSiteSettings();
  } catch (error) {
    console.error("Site settings preview lookup failed", error);
    return (
      <main className="stack">
        <section className="notice-card notice-card--error" role="alert">
          <strong>Draft settings preview unavailable</strong>
          <p>Strapi could not be reached. The published site remains unchanged.</p>
          <Link className="button button--ghost" href="/content/site-settings">Back to editor</Link>
        </section>
      </main>
    );
  }

  if (!settings) {
    notFound();
  }

  return (
    <>
      <aside className="notice-card" role="status">
        <strong>Draft settings preview</strong>
        <p>This protected preview is not the published site configuration.</p>
      </aside>
      <PastorWoodSitePreview
        siteSettings={{
          siteName: settings.siteName,
          topNavigation: navigation(settings.topNavigation),
          footerNavigation: navigation(settings.footerNavigation),
          utilityNavigation: navigation(settings.utilityNavigation),
          footerText: settings.footerText,
          copyrightText: settings.copyrightText,
          showDonateButton: settings.showDonateButton,
          donateButtonLabel: settings.donateButtonLabel,
          donateButtonUrl: settings.donateButtonUrl,
          donorDashboardUrl: settings.donorDashboardUrl,
          headerLogo: settings.headerLogo?.previewUrl ? {
            url: settings.headerLogo.previewUrl,
            alternativeText: settings.headerLogo.alternativeText,
            name: settings.headerLogo.name,
          } : null,
          subscriptionPublishedEnabled: settings.subscriptionEnabled,
          subscriptionEnabled: settings.subscriptionEnabled,
        }}
      />
    </>
  );
}
