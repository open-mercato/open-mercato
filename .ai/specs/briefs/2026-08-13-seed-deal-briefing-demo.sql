-- Demo seed for the ElevenLabs deal-briefing call.
--
-- Run against an instance that already has the customers example seed
-- (mercato auth setup --with-examples), because it UPDATES the Redwood deal
-- rather than creating one: seedCustomerExamples no-ops once those titles exist.
--
--   psql "$DATABASE_URL" -f 2026-08-13-seed-deal-briefing-demo.sql
--
-- Idempotent: re-running replaces the two seeded rows instead of duplicating
-- them, so you can reset between rehearsals.
--
-- What it sets up:
--   * Redwood Residences Solar Rollout is owned by employee@acme.com (Kuba) and
--     closes today, so the brief agent reads it as urgent.
--   * Daniel Cho becomes the prospect's CEO. He is already the deal's Executive
--     Sponsor and economic buyer, so no new person is created.
--   * An inbound email activity from Cho, minutes old, stating the objection
--     plainly. This is what the brief agent triages on: it has list_activities.
--   * A comment from superadmin@acme.com carrying the answer. The brief agent
--     has NO comments tool, so this stays invisible until the voice agent's
--     get_deal_notes fetches it — which only happens if the chief asks.

DO $$
DECLARE
  v_deal        uuid;
  v_tenant      uuid;
  v_org         uuid;
  v_company     uuid;
  v_ceo         uuid;
  v_rep         uuid;
  v_cho         uuid;
BEGIN
  SELECT id, tenant_id, organization_id
    INTO v_deal, v_tenant, v_org
    FROM customer_deals
   WHERE title = 'Redwood Residences Solar Rollout'
     AND deleted_at IS NULL
   LIMIT 1;

  IF v_deal IS NULL THEN
    RAISE EXCEPTION 'Redwood Residences Solar Rollout not found. Run the customers example seed first.';
  END IF;

  SELECT company_entity_id INTO v_company
    FROM customer_deal_company_links
   WHERE deal_id = v_deal
   LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'The Redwood deal has no linked company entity.';
  END IF;

  SELECT id INTO v_ceo FROM users WHERE email = 'superadmin@acme.com' LIMIT 1;
  SELECT id INTO v_rep FROM users WHERE email = 'employee@acme.com'   LIMIT 1;

  IF v_ceo IS NULL THEN
    RAISE EXCEPTION 'superadmin@acme.com not found. It is the tenant primary user — check which email set the tenant up.';
  END IF;
  IF v_rep IS NULL THEN
    RAISE EXCEPTION 'employee@acme.com not found. Demo users only exist with: mercato auth setup --include-demo-users';
  END IF;

  -- 1. Kuba owns the deal and it closes today.
  UPDATE customer_deals
     SET owner_user_id     = v_rep,
         expected_close_at = now(),
         updated_at        = now()
   WHERE id = v_deal;

  -- 2. Daniel Cho is the prospect's CEO. Seniority is left alone because
  --    'c_level' may not exist in this tenant's dictionary.
  UPDATE customer_person_profiles
     SET job_title = 'Chief Executive Officer'
   WHERE id IN (
     SELECT p.id
       FROM customer_person_profiles p
      WHERE p.email = 'daniel.cho@brightsidesolar.com'
   )
  RETURNING id INTO v_cho;

  IF v_cho IS NULL THEN
    RAISE NOTICE 'Daniel Cho not found by email; the demo still works, he is just not titled CEO.';
  END IF;

  -- 3. The objection. An ACTIVITY, because the brief agent reads activities.
  DELETE FROM customer_activities
   WHERE deal_id = v_deal
     AND subject = 'Re: Redwood Residences - contract draft';

  INSERT INTO customer_activities
    (organization_id, tenant_id, entity_id, deal_id, activity_type, subject, body,
     occurred_at, author_user_id, appearance_icon, appearance_color, created_at, updated_at)
  VALUES
    (v_org, v_tenant, v_company, v_deal, 'email',
     'Re: Redwood Residences - contract draft',
     'From Daniel Cho (CEO, Brightside Solar): I have read the latest version of the '
     || 'contract and it does not reflect what I agreed with your CEO. The commercial '
     || 'terms we settled on are simply not in this draft. I am not signing it as it '
     || 'stands, and we are due to meet in under an hour. Please tell me how you want '
     || 'to handle this.',
     now() - interval '6 minutes',
     NULL,
     'lucide:mail',
     '#dc2626',
     now(), now());

  -- 4. The answer. A COMMENT, because the brief agent has no comments tool and
  --    therefore cannot leak it into the spoken briefing.
  DELETE FROM customer_comments
   WHERE deal_id = v_deal
     AND author_user_id = v_ceo
     AND body LIKE 'Spoke with Daniel%';

  INSERT INTO customer_comments
    (organization_id, tenant_id, entity_id, deal_id, body, author_user_id,
     appearance_icon, appearance_color, created_at, updated_at)
  VALUES
    (v_org, v_tenant, v_company, v_deal,
     'Spoke with Daniel directly. We sign ASAP and the scope stays as quoted, but the '
     || 'first billing period does not start for three months - he needs that in the '
     || 'contract before it goes back to him. I told him we would sort it.',
     v_ceo,
     'lucide:notebook-pen',
     '#2563eb',
     now() - interval '2 days', now() - interval '2 days');

  -- 5. The meeting, so urgency is a fact in the data rather than an inference.
  DELETE FROM customer_activities
   WHERE deal_id = v_deal
     AND subject = 'Contract signing call';

  INSERT INTO customer_activities
    (organization_id, tenant_id, entity_id, deal_id, activity_type, subject, body,
     occurred_at, author_user_id, appearance_icon, appearance_color, created_at, updated_at)
  VALUES
    (v_org, v_tenant, v_company, v_deal, 'meeting',
     'Contract signing call',
     'Final call with Brightside Solar to walk through the contract and sign.',
     now() + interval '40 minutes',
     v_rep,
     'lucide:calendar-check',
     '#16a34a',
     now(), now());

  RAISE NOTICE 'Seeded. deal=% company_entity=% (use company_entity as company_id for the voice agent)', v_deal, v_company;
END $$;

-- The id the workflow needs as company_id, and a check that the two rows landed.
SELECT l.company_entity_id AS company_id_for_workflow,
       (SELECT count(*) FROM customer_comments   c WHERE c.deal_id = d.id) AS comments,
       (SELECT count(*) FROM customer_activities a WHERE a.deal_id = d.id) AS activities
  FROM customer_deals d
  JOIN customer_deal_company_links l ON l.deal_id = d.id
 WHERE d.title = 'Redwood Residences Solar Rollout'
   AND d.deleted_at IS NULL;
