-- Ingestion tables jobs reads (CI only; ingestion owns them).

CREATE TABLE IF NOT EXISTS public.import_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    url text,
    enabled boolean DEFAULT false NOT NULL,
    republish_allowed boolean DEFAULT false NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_run_at timestamp with time zone,
    last_status text,
    CONSTRAINT import_sources_kind_check CHECK ((kind = ANY (ARRAY['api'::text, 'rss'::text])))
);

ALTER TABLE ONLY public.import_sources FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.job_sources (
    job_id uuid NOT NULL,
    import_source_id uuid NOT NULL,
    external_id text NOT NULL,
    source_url text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    is_primary boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.job_sources FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_sources_name_key') THEN
    ALTER TABLE public.import_sources ADD CONSTRAINT import_sources_name_key UNIQUE (name);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_sources_pkey') THEN
    ALTER TABLE public.import_sources ADD CONSTRAINT import_sources_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_sources_pkey') THEN
    ALTER TABLE public.job_sources ADD CONSTRAINT job_sources_pkey PRIMARY KEY (import_source_id, external_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS job_sources_job_idx ON public.job_sources USING btree (job_id);

CREATE UNIQUE INDEX IF NOT EXISTS job_sources_primary_idx ON public.job_sources USING btree (job_id) WHERE is_primary;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_sources_import_source_id_fkey') THEN
    ALTER TABLE public.job_sources ADD CONSTRAINT job_sources_import_source_id_fkey FOREIGN KEY (import_source_id) REFERENCES public.import_sources(id) ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_sources_job_id_fkey') THEN
    ALTER TABLE public.job_sources ADD CONSTRAINT job_sources_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
  END IF;
END
$$;

ALTER TABLE public.import_sources ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'import_sources' AND policyname = 'import_sources_anon_deny') THEN
    CREATE POLICY import_sources_anon_deny ON public.import_sources TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'import_sources' AND policyname = 'import_sources_app_rw_all') THEN
    CREATE POLICY import_sources_app_rw_all ON public.import_sources TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'import_sources' AND policyname = 'import_sources_authenticated_deny') THEN
    CREATE POLICY import_sources_authenticated_deny ON public.import_sources TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.job_sources ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'job_sources' AND policyname = 'job_sources_anon_deny') THEN
    CREATE POLICY job_sources_anon_deny ON public.job_sources TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'job_sources' AND policyname = 'job_sources_app_rw_all') THEN
    CREATE POLICY job_sources_app_rw_all ON public.job_sources TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'job_sources' AND policyname = 'job_sources_authenticated_deny') THEN
    CREATE POLICY job_sources_authenticated_deny ON public.job_sources TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;
