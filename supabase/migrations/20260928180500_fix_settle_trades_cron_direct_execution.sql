select cron.alter_job(
  job_id := 9,
  command := 'select private.settle_due_trades();'
);