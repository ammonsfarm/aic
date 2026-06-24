begin;

alter table agent_settings
    add column if not exists rag_archive_top_k integer not null default 10,
    add column if not exists rag_archive_max_sources integer not null default 16,
    add column if not exists rag_research_source_budget integer not null default 24,
    add column if not exists rag_research_candidate_episodes integer not null default 8,
    add column if not exists rag_research_summary_episodes integer not null default 6,
    add column if not exists rag_research_detail_excerpts integer not null default 30,
    add column if not exists rag_research_max_sources integer not null default 40,
    add column if not exists rag_research_interview_inventory_limit integer not null default 60,
    add column if not exists rag_research_interview_max_sources integer not null default 72;

commit;
