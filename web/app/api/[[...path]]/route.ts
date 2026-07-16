import { dispatch } from "@/src/server/router";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => dispatch(req);
export const POST = (req: Request) => dispatch(req);
export const PATCH = (req: Request) => dispatch(req);
export const PUT = (req: Request) => dispatch(req);
export const DELETE = (req: Request) => dispatch(req);
