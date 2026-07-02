insert into content_pages(slug, title, page_type, status, created_by, updated_by)
values
  ('home', 'Home', 'landing', 'Draft', 'seed', 'seed'),
  ('about-pastor-wood', 'About Pastor Wood', 'standard', 'Draft', 'seed', 'seed'),
  ('radio', 'Radio', 'archive', 'Draft', 'seed', 'seed'),
  ('bible-study', 'Bible Study', 'archive', 'Draft', 'seed', 'seed'),
  ('written-resources', 'Written Resources', 'archive', 'Draft', 'seed', 'seed'),
  ('contact', 'Contact', 'standard', 'Draft', 'seed', 'seed'),
  ('donate', 'Donate', 'standard', 'Draft', 'seed', 'seed'),
  ('donor-dashboard', 'Donor Dashboard', 'standard', 'Draft', 'seed', 'seed'),
  ('endorsements', 'Endorsements', 'standard', 'Draft', 'seed', 'seed'),
  ('board-members', 'Board Members', 'standard', 'Draft', 'seed', 'seed'),
  ('privacy-terms-conditions', 'Privacy, Terms, and Conditions', 'policy', 'Draft', 'seed', 'seed'),
  ('privacy', 'Privacy Policy', 'policy', 'Draft', 'seed', 'seed')
on conflict (slug) do nothing;
