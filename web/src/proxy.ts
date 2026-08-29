import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRequest, parseAllowedHosts } from "@/lib/origin-guard.mjs";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="career-ops", charset="UTF-8"', "Cache-Control": "no-store" },
  });
}

function authConfigurationError(): NextResponse {
  return new NextResponse("Hosted authentication is not configured.", { status: 503, headers: { "Cache-Control": "no-store" } });
}

function checkBasicAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.CAREER_OPS_WEB_BASIC_AUTH?.trim();
  const required = process.env.CAREER_OPS_WEB_REQUIRE_AUTH === "true";
  if (!expected) return required ? authConfigurationError() : null;

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
  // Render needs an unauthenticated liveness probe. It exposes no user data and
  // is deliberately the only public route in a private deployment.
  if (req.nextUrl.pathname === "/api/health") return NextResponse.next();

  const denied = checkBasicAuth(req);
  if (denied) return denied;

  if (req.nextUrl.pathname.startsWith("/api/")) {
    const decision = checkRequest({
      secFetchSite: req.headers.get("sec-fetch-site"),
      origin: req.headers.get("origin"),
      host: req.headers.get("host"),
      allowedHosts: parseAllowedHosts(process.env.CAREER_OPS_WEB_ALLOWED_HOSTS),
    });
    if (!decision.ok) return NextResponse.json({ error: decision.reason }, { status: decision.status });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
