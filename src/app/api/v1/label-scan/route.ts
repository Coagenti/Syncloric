import { aiRuntime } from "@/server/services/ai/composition";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = aiRuntime.status;
export const POST = aiRuntime.POST;
