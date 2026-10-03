import { adminUsersRuntime } from "@/server/services/settings/admin-users-composition";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = adminUsersRuntime.GET;
export const POST = adminUsersRuntime.POST;
