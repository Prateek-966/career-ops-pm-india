import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRequest, parseAllowedHosts } from "@/lib/origin-guard.mjs";

// Single choke point over the API surface. Every /api request is gated on the
// same-origin + loopback guard before it can reach a route handler (which may
// spawn a child process or write the user's files). See origin-guard.mjs for
// the two-layer rationale (F1 drive-by CSRF, F2 LAN reachability).
//
// Opt in to extra hosts (e.g. a trusted LAN box) with a comma/space separated
// CAREER_OPS_WEB_ALLOWED_HOSTS; unset means loopback only.
//
// ── Why there is a second, outer layer ────────────────────────────────────
//
// CAREER_OPS_WEB_ALLOWED_HOSTS is a loaded gun when the opted-in host is
// PUBLIC rather than a trusted LAN box. Read checkRequest's fallback: a
// request carrying no Origin header at all — plain `curl` — is allowed
// through, because it cannot be browser CSRF. That is the correct call for a
// loopback dashboard and the wrong one for an internet-reachable deployment,
// where it hands anyone with the URL an unauthenticated path to routes that
// spawn processes and write files.
//
// So opting a public host in requires a credential as well. Set
// CAREER_OPS_WEB_BASIC_AUTH to `user:password` and every request — pages
// included, not just /api — must carry HTTP Basic auth. Unset, nothing below
// changes and local behaviour is byte-identical to before.
//
// This is a deployment guard, not an identity system: one shared credential,
// no sessions, no users. It exists so a hosted instance is not open to the
// world, and it is only as good as the password and TLS in front of it.

/** Constant-time string compare. Edge runtime has no node:crypto. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="career-ops", charset="UTF-8"' },
  });
}

/**
 * Check HTTP Basic auth when CAREER_OPS_WEB_BASIC_AUTH is configured.
 * Returns null to allow, or the 401 to send.
 */
function checkBasicAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.CAREER_OPS_WEB_BASIC_AUTH?.trim();
  if (!expected) return null; // not configured — loopback-only mode, unchanged

  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (!encoded || scheme?.toLowerCase() !== "basic") return unauthorized();

  let supplied: string;
  try {
    supplied = atob(encoded);
  } catch {
    return unauthorized();
  }
  return safeEqual(supplied, expected) ? null : unauthorized();
}

export function proxy(req: NextRequest) {
  // Outer layer first: on a configured deployment nothing is served, not even
  // a page, without the credential. Ordering matters — the origin guard below
  // only covers /api, so checking it first would leave every page public.
  const denied = checkBasicAuth(req);
  if (denied) return denied;

  if (req.nextUrl.pathname.startsWith("/api/")) {
    const decision = checkRequest({
      secFetchSite: req.headers.get("sec-fetch-site"),
      origin: req.headers.get("origin"),
      host: req.headers.get("host"),
      allowedHosts: parseAllowedHosts(process.env.CAREER_OPS_WEB_ALLOWED_HOSTS),
    });
    if (!decision.ok) {
      return NextResponse.json({ error: decision.reason }, { status: decision.status });
    }
  }
  return NextResponse.next();
}

// Everything except Next's own static assets. Widened from "/api/:path*" so the
// Basic-auth layer can cover pages too; the origin guard is still applied to
// /api only, by the pathname check above.
export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
