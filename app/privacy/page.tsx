import type { Metadata } from "next";
import { TopRail } from "@/components/top-rail";

export const metadata: Metadata = {
  title: "Privacy Policy | Pastor Wood Sermon Search GPT",
  description: "Privacy Policy for Pastor Wood Sermon Search GPT.",
};

const bulletItems = [
  "The search query or question you submit",
  "Basic technical request information, such as request time, endpoint used, and server logs",
  "Authentication headers used by ChatGPT to access the API",
];

const usedFor = [
  "Search the sermon transcript index",
  "Return relevant sermon transcript matches",
  "Help the GPT answer from retrieved sermon material",
  "Maintain and troubleshoot the API service",
];

const retention = [
  "Search query or question you submit",
  "Basic technical request information, such as request time, endpoint used, and server logs",
  "Authentication headers used by ChatGPT to access the API",
  "Server logs retained temporarily for troubleshooting, security, and maintenance",
];

export default function PrivacyPage() {
  return (
    <>
      <TopRail variant="public" />
      <main className="public-shell">
        <section className="route-panel route-panel--full">
          <div className="route-panel__main">
            <div className="route-panel__header">
              <div className="route-panel__title">
                <p className="eyebrow">Pastor Jim Wood</p>
                <h1>Privacy Policy for Pastor Wood Sermon Search GPT</h1>
              </div>
            </div>

            <div className="route-panel__body">
              <p>
                <strong>Effective Date:</strong> June 24, 2026
              </p>

              <section style={{ marginTop: 20 }}>
                <p>
                  Pastor Wood Sermon Search GPT is designed to help users ask questions about Pastor
                  Jim Wood&apos;s sermons and teaching. The GPT uses a connected search API to retrieve
                  relevant sermon transcript excerpts from a sermon transcript index.
                </p>
                <p>This GPT is intended for sermon research, Bible study, and educational use.</p>
              </section>

              <section style={{ marginTop: 20 }}>
                <h2>Information Sent to the API</h2>
                <p>
                  When you ask a question, the GPT may send your question or search phrase to the
                  connected sermon search API at:
                </p>
                <p>
                  <a href="https://aicrag.ammonsfarm.org" target="_blank" rel="noopener">
                    https://aicrag.ammonsfarm.org
                  </a>
                </p>
                <p>The API uses that text to search a private retrieval index of sermon transcripts and return matching transcript excerpts.</p>
              </section>

              <section style={{ marginTop: 20 }}>
                <h2>What Is Collected</h2>
                <ul>
                  {bulletItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p>
                  The API is not intended to collect sensitive personal information. Users should avoid
                  submitting private, confidential, medical, financial, or legally sensitive
                  information.
                </p>
              </section>

              <section style={{ marginTop: 20 }}>
                <h2>How Information Is Used</h2>
                <ul>
                  {usedFor.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p>The API does not use submitted questions to train AI models.</p>
              </section>

              <section style={{ marginTop: 20 }}>
                <h2>Data Sharing</h2>
                <p>Questions sent to the API are not sold to advertisers or shared for marketing purposes.</p>
                <p>
                  The API is hosted behind a secure endpoint and is used only to support this GPT&apos;s
                  sermon search functionality.
                </p>
              </section>

              <section style={{ marginTop: 20 }}>
                <h2>Data Retention</h2>
                <ul>
                  {retention.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p>
                  Logs are retained only as needed for operation and diagnostics.
                </p>
              </section>

              <section style={{ marginTop: 20 }}>
                <h2>Third-Party Services</h2>
                <p>
                  This GPT operates within ChatGPT and uses OpenAI&apos;s Custom GPT Actions feature to
                  call the connected API. Your use of ChatGPT is also subject to OpenAI&apos;s
                  applicable privacy and data policies.
                </p>
                <p>
                  The connected API may be routed through Cloudflare for secure access and traffic
                  routing.
                </p>
              </section>

              <section style={{ marginTop: 20 }}>
                <h2>Security</h2>
                <p>
                  The connected API requires bearer-token authentication. Reasonable safeguards are used
                  to limit unauthorized access.
                </p>
                <p>
                  No internet-connected system can be guaranteed completely secure, so users should
                  not submit sensitive personal information.
                </p>
              </section>

              <section style={{ marginTop: 20 }}>
                <h2>Children&apos;s Privacy</h2>
                <p>
                  This GPT is not designed to knowingly collect personal information from children. It
                  is intended for general sermon research and Bible study.
                </p>
              </section>

              <section style={{ marginTop: 20 }}>
                <h2>Contact</h2>
                <p>
                  For questions about this privacy policy or the sermon search API, contact the GPT
                  owner or administrator.
                </p>
              </section>

              <section style={{ marginTop: 20 }}>
                <h2>Changes to This Policy</h2>
                <p>
                  This privacy policy may be updated from time to time. Updates will be reflected by
                  changing the effective date above.
                </p>
              </section>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
