import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Host-based routing so one Worker serves both sites:
//   hf-os.com / www.hf-os.com  -> public marketing landing at "/"
//   app.hf-os.com              -> the product ("/" jumps straight to the app)
export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") || "").toLowerCase();
  const isAppHost = host.startsWith("app.");
  if (isAppHost && req.nextUrl.pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Only run on the root path; everything else is served normally.
export const config = { matcher: ["/"] };
