# FLEXAR diagnostics

The browser collector is initialized from `src/main.jsx` and reports sanitized diagnostic events to the Supabase Edge Function `diagnostic-ingest`. The events are stored in `public.client_diagnostic_events`.

## What is collected
- Uncaught JavaScript errors and unhandled promise rejections.
- Failed page resources.
- HTTP requests returning 4xx/5xx, network exceptions, and requests taking 10 seconds or more.
- Online/offline transitions and page-load timing.
- A random diagnostic ID and session ID to group related events.

## Privacy and scope
- Request paths are stored without query strings or URL fragments.
- Request/response bodies, passwords, tokens, cookies, authorization headers, and user-entered form contents are not collected.
- The collector does not change trading, payment, balance, or strategy logic.
- The browser keeps a small bounded in-memory queue and uploads in batches. If the browser is offline or the upload fails, some events may not persist after the page closes.
- Backend Edge Function and database service logs remain available through Supabase's native logs and should be correlated by timestamp with browser diagnostic events.

## Investigating incidents
Use the Supabase SQL editor or connected diagnostics tooling.

Recent events:
```sql
SELECT created_at, level, source, event_name, message, http_status,
       duration_ms, page_path, request_path, diagnostic_id, metadata
FROM public.client_diagnostic_events
WHERE created_at >= now() - interval '24 hours'
ORDER BY created_at DESC
LIMIT 200;
```

Group repeated failures:
```sql
SELECT event_name, source, message, http_status, count(*) AS occurrences,
       max(created_at) AS last_seen
FROM public.client_diagnostic_events
WHERE created_at >= now() - interval '24 hours'
GROUP BY event_name, source, message, http_status
ORDER BY occurrences DESC, last_seen DESC
LIMIT 50;
```

Trace one browser diagnostic ID:
```sql
SELECT *
FROM public.client_diagnostic_events
WHERE diagnostic_id = 'PASTE_DIAGNOSTIC_ID'
ORDER BY created_at ASC;
```

Do not expose diagnostic records publicly. Table access is restricted to the service role; browser clients submit only through the Edge Function.
