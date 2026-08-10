-- PR 4a — fix increment_discount_usage, which incremented EVERY discount row.
--
-- The original body was:
--
--   update discounts set times_used = times_used + 1 where discounts.code = code;
--
-- with the function's parameter also named `code`. In a LANGUAGE sql function the bare `code`
-- on the right-hand side resolves to the COLUMN, not the parameter, so the predicate reads
-- `discounts.code = discounts.code` — true for every row. Verified against production inside a
-- rolled-back transaction: calling it with 'NONEXISTENT-CODE-XYZ' took both live codes from
-- times_used 0 to 1.
--
-- It has never actually fired, because its only caller was itself broken (an UPDATE with no
-- filter that assigned a query builder as the column value), and no reservation has ever used
-- a discount code. So this is a latent bug, not damage to repair — but it is the counter
-- max_uses is enforced against, and PR 4a starts enforcing max_uses on the server.
--
-- The parameter is renamed to p_code so it cannot be shadowed by the column again. Renaming an
-- input parameter is not something CREATE OR REPLACE permits, hence the DROP first.

DROP FUNCTION IF EXISTS public.increment_discount_usage(text);

CREATE FUNCTION public.increment_discount_usage(p_code text)
RETURNS void
LANGUAGE sql
SET search_path TO 'public', 'pg_temp'
AS $function$
  update discounts
     set times_used = coalesce(times_used, 0) + 1
   where discounts.code = p_code;
$function$;

-- Sanity check the fix, without leaving a mutation behind:
--
--   begin;
--   select increment_discount_usage('NONEXISTENT-CODE-XYZ');
--   select code, times_used from discounts order by code;  -- must be UNCHANGED
--   rollback;
