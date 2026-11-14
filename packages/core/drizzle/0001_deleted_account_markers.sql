CREATE TABLE "deleted_account_markers" (
	"telegram_id_hash" text PRIMARY KEY NOT NULL,
	"free_slideshows_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
