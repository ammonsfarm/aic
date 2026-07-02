-- Seed CMS inventory for existing public routes.
-- This is intentionally draft-only. It does not change public rendering.

with page_seed(slug, title, page_type, hero_title, hero_body) as (
  values
    ('home', 'Home', 'landing', 'Welcome to Abiding in Christ', 'A ministry of Pastor Jim Wood.'),
    ('about-pastor-wood', 'About Pastor Wood', 'standard', 'Jim Wood', 'Founder of Wears Valley Ranch, pastor, author, and host of Abiding in Christ.'),
    ('radio', 'Radio', 'archive', 'Radio Show Listings', 'Listen to recent Abiding in Christ broadcasts.'),
    ('bible-study', 'Bible Study', 'archive', 'Weekly Devotional', 'Recent devotional posts from Pastor Wood.'),
    ('written-resources', 'Written Resources', 'archive', 'Written Resources', 'Articles and written resources from Pastor Wood.'),
    ('contact', 'Contact', 'standard', 'Get in touch', 'Contact the ministry office or invite Pastor Wood to speak.'),
    ('donate', 'Donate', 'standard', 'Donate Today', 'Support Pastor Wood and Abiding in Christ.'),
    ('donor-dashboard', 'Donor Dashboard', 'standard', 'Donor Dashboard', 'Access donor account and giving history links.'),
    ('endorsements', 'Endorsements', 'standard', 'Endorsements', 'Public endorsements for Pastor Wood and Abiding in Christ.'),
    ('board-members', 'Board Members', 'standard', 'Board Members', 'Abiding in Christ board member information.'),
    ('privacy-terms-conditions', 'Privacy, Terms, and Conditions', 'policy', 'Privacy, Terms, and Conditions', 'Policy source for privacy, terms, and conditions.'),
    ('privacy', 'Privacy Policy', 'policy', 'Privacy Policy', 'Privacy policy for the Pastor Wood sermon search and AIC tools.')
),
upsert_pages as (
  insert into content_pages(slug, title, page_type, status, created_by, updated_by)
  select slug, title, page_type, 'Draft', 'seed', 'seed'
  from page_seed
  on conflict (slug) do update
  set title = excluded.title,
      page_type = excluded.page_type,
      updated_by = 'seed',
      updated_at = now()
  returning id, slug
)
insert into content_page_revisions(
  page_id,
  revision_number,
  title,
  seo_title,
  seo_description,
  hero_title,
  hero_body,
  body_json,
  body_html,
  status,
  created_by,
  change_note
)
select
  p.id,
  1,
  s.title,
  s.title,
  'Draft CMS inventory seed for current public route.',
  s.hero_title,
  s.hero_body,
  jsonb_build_object(
    'seedSource', 'current-public-route',
    'slug', s.slug,
    'phase', 'phase-2-inventory'
  ),
  '',
  case when s.slug in ('about-pastor-wood', 'contact') then 'Published' else 'Draft' end,
  'seed',
  'Initial CMS inventory seed. Public rendering still uses current Next.js routes.'
from upsert_pages p
join page_seed s on s.slug = p.slug
where not exists (
  select 1
  from content_page_revisions r
  where r.page_id = p.id
    and r.revision_number = 1
);

update content_page_revisions r
set status = 'Published'
from content_pages p
where p.id = r.page_id
  and p.slug in ('about-pastor-wood', 'contact')
  and r.revision_number = 1;

update content_pages p
set status = 'Published',
    published_revision_id = r.id,
    published_at = coalesce(p.published_at, now()),
    updated_by = 'seed',
    updated_at = now()
from content_page_revisions r
where r.page_id = p.id
  and p.slug in ('about-pastor-wood', 'contact')
  and r.revision_number = 1;
