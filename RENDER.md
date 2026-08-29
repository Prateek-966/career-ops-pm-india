# Private Render deployment

This Blueprint deploys a **single-user** career-ops instance. It uses a persistent disk because the application stores your CV, tracker, reports, generated PDFs, and job artifacts on disk.

## Required secret settings

Set these in Render after creating the service. Never commit them.

- \`CAREER_OPS_WEB_BASIC_AUTH\`: one high-entropy \`username:password\` value. This protects every page and API route.
- \`CAREER_OPS_WEB_ALLOWED_HOSTS\`: your exact Render/custom hostname, without a protocol. This is required by the API origin/host guard. Multiple trusted hostnames can be comma-separated.
- \`FIRECRAWL_API_KEY\`: enables the Firecrawl tab.
- \`APIFY_TOKEN\` and \`INDEED_APIFY_ACTOR\`: enable the Indeed tab through your approved Apify actor. Set the actor id in \`owner/actor\` form.

The health endpoint is intentionally public and returns only \`{"status":"ok"}\`; it exists solely for Render health checks.

## What the Sources page does

- **Indeed:** submits the role and location to your configured Apify actor and clearly labels returned cards as Indeed.
- **Firecrawl:** searches only the employer domains entered in the UI, requests main-page markdown, and clearly labels returned cards as Firecrawl.

Firecrawl has no unscoped open-web mode in this UI. Enter only employer career-site domains, not job-board domains.

## Important limits

This remains a personal deployment. The existing local CLI and browser-automation features are not a multi-user product. Do not share the Basic Auth credential. Use a long random password and HTTPS-only Render/custom-domain access.