import { foodEntryHandlers } from "@/server/services/foods/entry-composition";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return foodEntryHandlers.GET(request, (await context.params).id); }
export async function PATCH(request: Request, context: Context) { return foodEntryHandlers.PATCH(request, (await context.params).id); }
