-- Customer-service: optional read-only business-query endpoints.
--
-- Stores a JSON array of `{name, url_template, description}` objects. The
-- customer-service engine exposes one safe read-only HTTP GET tool per
-- endpoint; the agent can NEVER reach arbitrary hosts — only the configured
-- https endpoints (SSRF-guarded). This is the "只读业务查询工具" capability:
-- order / logistics / inventory lookups without ever touching terminal,
-- file, browser, or write paths.
--
-- `business_endpoints` is a non-`_id` column (just a JSON payload), so it
-- needs no logical-reference registration.

ALTER TABLE cs_agents ADD COLUMN business_endpoints TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(business_endpoints) AND json_type(business_endpoints) = 'array');
