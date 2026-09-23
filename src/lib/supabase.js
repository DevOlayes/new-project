import { createClient } from "@supabase/supabase-js";

// Only the public/publishable Supabase values belong in the browser.
// Never put the service_role/secret key in VITE_* variables.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase =
  supabaseUrl && supabasePublishableKey
    ? createClient(supabaseUrl, supabasePublishableKey)
    : null;