# DEMO: Lawn Desk

flue, flue/react, cloudflare

## Who it is for and what it does

**For Dave**, a fictional one-person lawn-mowing business. Dave mows yards all morning
and cannot hear his phone over the mower, so customer texts wait until the work is
done.

**The agent answers those texts for him:**
- It reads the customer's name, address, town, and yard size from the texts, and asks
  only for what is missing.
- It quotes a price from Dave's rules.
- It offers two open times on the weekdays Dave works in that town.
- It books the time the customer picks.
- It hands off to Dave what it cannot decide: out-of-area, yards over 1 acre,
  complaints, refunds, haggling.

The demo uses a web SMS simulator instead of real SMS, so reviewers can test it in a
browser with no phone number.

## Progress

Updated with every merged feature.

**Works now**
- Two Cloudflare Workers: `backend/` runs the Flue agent on Workers AI, and
  `frontend/` serves a React chat and forwards `/api/*` to the backend through a
  service binding.
- Local dev: a message from the browser reaches the agent and the reply streams back
  ("typing…" while it streams).

**Not yet**
- The agent is a placeholder. It has no price rules or schedule yet, so it makes up
  prices.
- Booking store and calendar, agent tools, and handoff to Dave.
- Reviewer sign-in and per-visitor isolation.
- The SMS simulator UI: customer phone, Dave's phone, calendar, price table.
- Production deploy.
