import { TopRail } from "@/components/top-rail";
import { RoutePanel } from "@/components/route-panel";
import { RagChatWidget } from "@/components/rag-chat-widget";
import { requireResearchConsoleUser } from "@/lib/console-access";

export const dynamic = "force-dynamic";

const starterQuestions = [
  "How many episodes are Pastor Wood interviewing someone?",
  "What childhood stories does Pastor Wood tell?",
  "Where does Pastor Wood discuss Mark chapter 2?",
  "What sermon illustrations involve Wears Valley Ranch?",
];

export default async function ResearchPage() {
  await requireResearchConsoleUser();

  return (
    <>
      <TopRail variant="public" />
      <main className="public-shell">
        <RoutePanel
          eyebrow="Research"
          title="Ask the full archive"
          aside={
            <div className="research-aside">
              <p>
                The agent searches structured episode intelligence first, then semantic transcript and
                intelligence vectors, weekly devotional posts, then transcript detail where exact wording is needed.
              </p>
              <div className="research-aside__list" aria-label="Research retrieval order">
                <span>Structured summaries and extracted items</span>
                <span>Semantic matches across the corpus</span>
                <span>Pastor Wood weekly devotional posts</span>
                <span>Full transcript detail escalation</span>
              </div>
            </div>
          }
        >
          <RagChatWidget
            action="/api/research/chat"
            heading="Archive research agent"
            description="Ask source-backed questions across indexed episodes, sermons, interviews, transcripts, and weekly devotionals."
            submitLabel="Research"
            sourceLabel="Research sources"
            placeholder="Ask about a theme, person, Bible passage, story, sermon illustration, guest, or repeated teaching across the archive."
            starterQuestions={starterQuestions}
            showDiagnostics
            historyScope="research"
          />
        </RoutePanel>

        <section className="research-method">
          <div>
            <p className="eyebrow">Evidence model</p>
            <h2>Search wide, then prove narrow</h2>
            <p>
              Broad questions start from the structured intelligence tables so interview, story,
              topic, scripture, and summary data can identify candidate episodes. The agent then
              uses semantic retrieval, devotional post retrieval, and full transcript matches to ground the answer in source text.
            </p>
          </div>
          <div>
            <p className="eyebrow">Source discipline</p>
            <h2>Answers show their work</h2>
            <p>
              Every answer includes citations, retrieval lanes, and a coverage note. When the
              evidence is a sample rather than a complete inventory, the answer should say so.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
