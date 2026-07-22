import { TopRail } from "@/components/top-rail";
import { RoutePanel } from "@/components/route-panel";
import { ReadingPlanBuilder } from "@/components/reading-plan-builder";
import { requireResearchConsoleUser } from "@/lib/console-access";

export const dynamic = "force-dynamic";

export default async function ReadingPlanPage() {
  await requireResearchConsoleUser();

  return (
    <>
      <TopRail variant="public" />
      <main className="public-shell">
        <RoutePanel
          eyebrow="Reading plan"
          title="Build a source-backed Bible reading plan"
          aside={
            <div className="reading-plan-aside">
              <p>
                Plans pair a Scripture schedule with AIC archive retrieval. The generated study notes show
                whether the archive support is direct, thematic, or style-guided.
              </p>
              <div className="reading-plan-aside__list" aria-label="Reading plan evidence model">
                <span>Scripture reference schedule</span>
                <span>YouVersion passage preview</span>
                <span>AIC sermon and intelligence sources</span>
              </div>
            </div>
          }
        >
          <ReadingPlanBuilder />
        </RoutePanel>
      </main>
    </>
  );
}
