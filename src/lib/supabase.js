import { createClient } from "@supabase/supabase-js";

// Flexa AI uses only Supabase's browser-safe project URL and publishable key.
// These fallback values let the Cloudflare deployment work even when VITE_*
// environment variables have not yet been added to the Worker settings.
// Never put a service_role/secret key here.
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://kuwpxpninjdvmkqkaxoi.supabase.co";

const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_aMUzKrBjzxRQPwCoTU3iQA_ATrcGeBp";

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey
);
