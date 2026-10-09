CREATE TABLE IF NOT EXISTS public.client_diagnostic_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  event_time timestamptz NOT NULL,
  diagnostic_id text NOT NULL,
  session_id text NOT NULL,
  level text NOT NULL CHECK (level IN ('info','warning','error')),
  source text NOT NULL,
  event_name text NOT NULL,
  message text NOT NULL,
  stack text,
  page_path text,
  request_path text,
  http_status integer,
  duration_ms integer,
  browser_family text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS client_diagnostic_events_created_at_idx ON public.client_diagnostic_events (created_at DESC);
CREATE INDEX IF NOT EXISTS client_diagnostic_events_diag_id_idx ON public.client_diagnostic_events (diagnostic_id);
ALTER TABLE public.client_diagnostic_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.client_diagnostic_events FROM anon, authenticated, public;
GRANT SELECT, INSERT ON TABLE public.client_diagnostic_events TO service_role;
REVOKE ALL ON SEQUENCE public.client_diagnostic_events_id_seq FROM anon, authenticated, public;
GRANT USAGE, SELECT ON SEQUENCE public.client_diagnostic_events_id_seq TO service_role;
