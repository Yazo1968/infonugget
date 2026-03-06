import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ── Env ──
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Service client (bypasses RLS to query all users) ──
function serviceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Delete file from Anthropic Files API directly ──
async function deleteAnthropicFile(fileId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.anthropic.com/v1/files/${fileId}`, {
      method: "DELETE",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
    });
    // 200 = deleted, 404 = already gone — both are success
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  // ── CORS preflight ──
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ── Auth: verify cron secret ──
  if (CRON_SECRET) {
    const cronSecret = req.headers.get("x-cron-secret");
    if (cronSecret !== CRON_SECRET) {
      return jsonRes({ error: "Unauthorized" }, 401);
    }
  }

  try {
    const db = serviceClient();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Query stale documents via the database function
    const { data: docs, error } = await db.rpc("get_stale_file_documents", {
      cutoff_time: cutoff,
    });

    if (error) {
      console.error("RPC error:", error);
      return jsonRes({ error: error.message }, 500);
    }

    if (!docs || docs.length === 0) {
      return jsonRes({ deleted: 0, failed: 0, total: 0, message: "No stale files found" });
    }

    console.log(`Found ${docs.length} stale file(s) to clean up`);

    let deleted = 0;
    let failed = 0;

    for (const doc of docs) {
      // Delete from Anthropic Files API
      const success = await deleteAnthropicFile(doc.file_id);

      if (success) {
        // Clear file_id in the database
        const { error: updateErr } = await db
          .from("documents")
          .update({ file_id: null })
          .eq("nugget_id", doc.nugget_id)
          .eq("id", doc.doc_id);

        if (!updateErr) {
          deleted++;
          console.log(`Deleted file ${doc.file_id} for doc ${doc.doc_id}`);
        } else {
          failed++;
          console.error(`DB update failed for doc ${doc.doc_id}:`, updateErr);
        }
      } else {
        failed++;
        console.error(`Anthropic delete failed for file ${doc.file_id}`);
      }
    }

    console.log(`Cleanup complete: ${deleted} deleted, ${failed} failed, ${docs.length} total`);
    return jsonRes({ deleted, failed, total: docs.length });
  } catch (err) {
    console.error("Cleanup error:", err);
    return jsonRes({ error: String(err) }, 500);
  }
});
