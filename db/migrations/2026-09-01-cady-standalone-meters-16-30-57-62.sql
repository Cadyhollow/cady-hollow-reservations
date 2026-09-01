-- Cady: add meters 16, 30, 57, 62 as STANDALONE read points. APPLIED 2026-09-01.
--
-- The registry was seeded from `sites`, so these four were dropped — they have no site row. They
-- are real physical meters Charissa reads every cycle: pitches currently out of commission for
-- various issues, and 30 is Cabin 1 (cabins are not used for long-term campers).
--
-- ⚠ NO `sites` ROW IS CREATED, AND THAT IS THE WHOLE CARE OF THIS FILE.
--
-- `sites.is_available` DEFAULTS TO TRUE and /api/availability filters on exactly that column, so
-- inventing a site row to hang a meter on is precisely how an out-of-commission pitch quietly
-- reappears in what guests can book. Verified before and after: 89 sites, 88 bookable, unchanged.
--
-- These ARE genuine sites and may be booked again one day. That costs nothing here: the meter →
-- site link is optional metadata, not identity. When a pitch comes back into commission it gets a
-- normal row on the Sites screen, and the meter keeps working either way — matched on its number
-- before the link exists, through the link afterwards.
--
-- Record-only today: nobody is on these numbers, so Auto bills nothing and no draft is staged.
-- Idempotent: guarded on the meter number.

INSERT INTO public.meters (meter_number, site_id, label, notes, active, display_order)
SELECT v.num, NULL, v.label, v.note, true, 0
  FROM (VALUES
    ('16', '',        'Real pitch, currently out of commission — read every cycle.'),
    ('30', 'Cabin 1', 'Cabin 1, read under meter number 30. Cabins are not used for long-term campers.'),
    ('57', '',        'Real pitch, currently out of commission — read every cycle.'),
    ('62', '',        'Real pitch, currently out of commission — read every cycle.')
  ) AS v(num, label, note)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.meters m WHERE lower(btrim(m.meter_number)) = lower(btrim(v.num))
 );

-- Result: 79 meters, 1..79 complete with no gaps. 75 site-linked, 4 standalone.
