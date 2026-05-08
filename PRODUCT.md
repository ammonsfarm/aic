# AIC Website Product Register

## Register

Product UI. The website is primarily a private scholarly production console, with a smaller public publishing surface added after the owner console is stable.

## Product Name

Mountain Study Console.

## Primary Users

Owner: the person responsible for reviewing podcast performance, corpus health, sermon research, and publication readiness. The owner needs full access to private stats, retrieval traces, drafts, pipeline state, and user settings.

Editor: a trusted helper who can browse episodes, inspect sources, compose drafts, and review public-ready material. The editor should not see raw provider secrets, private credentials, or unredacted logs.

Viewer: a read-mostly private user who can inspect episodes, summaries, sources, and high-level stats without changing operational settings or triggering processing jobs.

Public visitor: a signed-out website visitor who can browse approved public episodes, topics, scripture pages, summaries, search results, and approved transcript excerpts. Public visitors must never see Podtrac metrics, raw prompts, provider internals, RAG logs, pipeline status, or unreviewed generated drafts.

## Product Purpose

The product turns the Abiding in Christ podcast corpus into a secure research and publishing workspace. It should help the owner understand podcast performance, inspect sermon and interview intelligence, retrieve source-backed context, draft new material responsibly, and monitor the ingestion pipeline.

## Trust Principles

All meaningful claims should be source-backed. RAG answers, content drafts, summaries, and operational signals must show where data came from, what retrieval lanes were used, and what is exact versus estimated.

Generated material must be labeled as newly generated content informed by the corpus. It must not imply that new drafts are verbatim Pastor Wood sermons.

Operational pages should prefer honest incomplete states over decorative confidence. Missing credentials, failed syncs, unmatched Podtrac records, extractive-only intelligence rows, and pending provider integrations should be visible.

## Private And Public Boundaries

Private-only data includes Podtrac metrics, country/client stats, pipeline internals, RAG prompts and logs, provider configuration, transcript processing status, unmatched records, raw draft requests, and private notes.

Public-safe data includes approved episode metadata, publish dates, public summaries, scripture references, topics, related episodes, public audio links, and transcript text only when the public-content policy allows it.

The code should enforce boundaries server-side. A hidden UI element is not a security control.

## Tone

Calm, grounded, scholarly, practical. The interface should feel like a quiet study desk in a Wears Valley cabin at sunrise: useful, focused, source-aware, and unhurried.

## Anti-References

Avoid generic SaaS dashboard patterns, repeated metric-card grids, fake KPIs, decorative hero sections, dark-blue analytics cliches, glass panels, gradient text, gratuitous blur, decorative badges, and unlabeled estimated data.

## Product Promises

The console should answer three questions quickly:

1. What is happening in the podcast corpus and stats right now?
2. What source evidence supports this answer, draft, or operational signal?
3. What needs review before it becomes public or trusted?
