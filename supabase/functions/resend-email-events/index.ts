// Supabase Edge Function entry point. All logic is in handler.ts (tested locally under Node).
import { createHandler } from "./handler.ts";

Deno.serve(createHandler({ env: (k) => Deno.env.get(k), fetch }));
