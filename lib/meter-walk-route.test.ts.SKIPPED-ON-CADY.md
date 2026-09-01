# `lib/meter-walk-route.test.ts` is DELIBERATELY NOT PORTED TO CADY

The template has an end-to-end route test for the meter walk. It is excellent there and it is
**not safe here**, for one reason that has nothing to do with the test's quality:

> `.env.local` in this repo points at the **LIVE PRODUCTION DATABASE**.

That test creates reading sessions, meter readings and draft electric bills, then deletes them.
Against the Test Sandbox that is exactly right. Against Cady it would write to — and delete from —
the database 49 paying seasonal campers are billed out of, for no benefit: it would be testing
code that is identical to the code the sandbox already proved.

It never posts a charge, and it does clean up after itself. That is not the point. The point is
that a test which writes has no business living in a repo whose test credentials are production
credentials, because the cost of someone running it on the wrong day is unbounded and the upside
is zero.

## What IS ported, and is safe to run here

The pure unit tests, which touch no database at all:

    node --test lib/meters.test.ts lib/electric-billing.test.ts \
                lib/payment-schedule.test.ts lib/receipt-lines.test.ts \
                lib/guest-record.test.ts lib/seasonal-directory.test.ts

These cover the billing rule (Auto / Don't bill, seasonal-or-monthly, never transient), the
electric arithmetic, the double-site summing, meter replacement, and the draft-bill construction.

## If you ever want the route test here

Point `.env.local` at a Cady-shaped **test** tenant first. Until production and test credentials
are separated in this repo, that is the only safe way to run anything that writes.
