import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ── Env ──
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Service client (bypasses RLS to operate across all users) ──
function serviceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── List all files in a storage bucket with pagination ──
async function listAllFiles(
  db: ReturnType<typeof serviceClient>,
  bucket: string,
): Promise<{ name: string; id?: string }[]> {
  const allFiles: { name: string; id?: string }[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await db.storage
      .from(bucket)
      .list("", { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });

    if (error) {
      console.error(`Error listing ${bucket} bucket:`, error);
      break;
    }
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allFiles.push(...data);
      offset += data.length;
      hasMore = data.length === PAGE_SIZE;
    }
  }
  return allFiles;
}

// ── Recursively list all files under a prefix ──
async function listFilesRecursive(
  db: ReturnType<typeof serviceClient>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  const PAGE_SIZE = 1000;

  async function walk(currentPrefix: string) {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await db.storage
        .from(bucket)
        .list(currentPrefix, { limit: PAGE_SIZE, offset });

      if (error || !data || data.length === 0) {
        hasMore = false;
        break;
      }

      for (const item of data) {
        const fullPath = currentPrefix ? `${currentPrefix}/${item.name}` : item.name;
        if (item.id) {
          // It's a file
          paths.push(fullPath);
        } else {
          // It's a folder — recurse
          await walk(fullPath);
        }
      }

      offset += data.length;
      hasMore = data.length === PAGE_SIZE;
    }
  }

  await walk(prefix);
  return paths;
}

// ── Phase 1: Find and delete orphaned PDFs ──
async function cleanOrphanedPdfs(
  db: ReturnType<typeof serviceClient>,
): Promise<{ deleted: number; errors: number }> {
  let deleted = 0;
  let errors = 0;

  const files = await listFilesRecursive(db, "pdfs", "");
  if (files.length === 0) return { deleted, errors };

  console.log(`Phase 1: Checking ${files.length} PDF file(s) for orphans...`);

  for (const path of files) {
    // Check if any document row references this storage path
    const { data, error } = await db
      .from("documents")
      .select("id")
      .eq("pdf_storage_path", path)
      .limit(1);

    if (error) {
      console.error(`Error checking PDF ${path}:`, error);
      errors++;
      continue;
    }

    if (!data || data.length === 0) {
      // Orphaned — no document row references this file
      const { error: delErr } = await db.storage.from("pdfs").remove([path]);
      if (delErr) {
        console.error(`Failed to delete orphaned PDF ${path}:`, delErr);
        errors++;
      } else {
        console.log(`Deleted orphaned PDF: ${path}`);
        deleted++;
      }
    }
  }

  return { deleted, errors };
}

// ── Phase 2: Find and delete orphaned card images ──
async function cleanOrphanedImages(
  db: ReturnType<typeof serviceClient>,
): Promise<{ deleted: number; errors: number }> {
  let deleted = 0;
  let errors = 0;

  const files = await listFilesRecursive(db, "card-images", "");
  if (files.length === 0) return { deleted, errors };

  console.log(`Phase 2: Checking ${files.length} card image(s) for orphans...`);

  for (const path of files) {
    // Check if any card_images row references this storage path
    const { data, error } = await db
      .from("card_images")
      .select("id")
      .eq("storage_path", path)
      .limit(1);

    if (error) {
      console.error(`Error checking image ${path}:`, error);
      errors++;
      continue;
    }

    if (!data || data.length === 0) {
      // Orphaned — no card_images row references this file
      const { error: delErr } = await db.storage.from("card-images").remove([path]);
      if (delErr) {
        console.error(`Failed to delete orphaned image ${path}:`, delErr);
        errors++;
      } else {
        console.log(`Deleted orphaned image: ${path}`);
        deleted++;
      }
    }
  }

  return { deleted, errors };
}

// ── Phase 3: Find and delete orphaned nuggets ──
// Nuggets not referenced by any project, older than 7 days (grace period)
async function cleanOrphanedNuggets(
  db: ReturnType<typeof serviceClient>,
): Promise<{ deleted: number; errors: number }> {
  let deleted = 0;
  let errors = 0;

  // Get all nugget IDs
  const { data: allNuggets, error: nErr } = await db
    .from("nuggets")
    .select("id, created_at");

  if (nErr || !allNuggets) {
    console.error("Error loading nuggets:", nErr);
    return { deleted, errors };
  }

  // Get all project nugget_ids arrays
  const { data: allProjects, error: pErr } = await db
    .from("projects")
    .select("nugget_ids");

  if (pErr) {
    console.error("Error loading projects:", pErr);
    return { deleted, errors };
  }

  // Build set of all referenced nugget IDs
  const referencedIds = new Set<string>();
  for (const p of allProjects || []) {
    if (Array.isArray(p.nugget_ids)) {
      for (const id of p.nugget_ids) referencedIds.add(id);
    }
  }

  // 7-day grace period
  const graceCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const orphans = allNuggets.filter(
    (n) => !referencedIds.has(n.id) && n.created_at < graceCutoff,
  );

  if (orphans.length === 0) {
    console.log("Phase 3: No orphaned nuggets found.");
    return { deleted, errors };
  }

  console.log(`Phase 3: Found ${orphans.length} orphaned nugget(s) to clean up...`);

  for (const nugget of orphans) {
    try {
      // Read storage paths from child rows before CASCADE deletes them
      const { data: docs } = await db
        .from("documents")
        .select("pdf_storage_path")
        .eq("nugget_id", nugget.id);

      const { data: images } = await db
        .from("card_images")
        .select("storage_path")
        .eq("nugget_id", nugget.id);

      // Delete PDF storage files
      const pdfPaths = (docs || [])
        .map((d) => d.pdf_storage_path)
        .filter(Boolean) as string[];
      if (pdfPaths.length > 0) {
        await db.storage.from("pdfs").remove(pdfPaths);
      }

      // Delete card image storage files
      const imgPaths = (images || [])
        .map((i) => i.storage_path)
        .filter(Boolean) as string[];
      if (imgPaths.length > 0) {
        await db.storage.from("card-images").remove(imgPaths);
      }

      // Delete nugget row — CASCADE deletes documents + card_images rows
      const { error: delErr } = await db
        .from("nuggets")
        .delete()
        .eq("id", nugget.id);

      if (delErr) {
        console.error(`Failed to delete orphaned nugget ${nugget.id}:`, delErr);
        errors++;
      } else {
        console.log(`Deleted orphaned nugget: ${nugget.id} (${pdfPaths.length} PDFs, ${imgPaths.length} images)`);
        deleted++;
      }
    } catch (err) {
      console.error(`Error cleaning nugget ${nugget.id}:`, err);
      errors++;
    }
  }

  return { deleted, errors };
}

// ── Main handler ──
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify cron secret
  if (CRON_SECRET) {
    const cronSecret = req.headers.get("x-cron-secret");
    if (cronSecret !== CRON_SECRET) {
      return jsonRes({ error: "Unauthorized" }, 401);
    }
  }

  try {
    const db = serviceClient();

    console.log("Starting orphan cleanup...");

    const pdfs = await cleanOrphanedPdfs(db);
    const images = await cleanOrphanedImages(db);
    const nuggets = await cleanOrphanedNuggets(db);

    const stats = {
      orphanedPdfs: pdfs,
      orphanedImages: images,
      orphanedNuggets: nuggets,
      totalDeleted: pdfs.deleted + images.deleted + nuggets.deleted,
      totalErrors: pdfs.errors + images.errors + nuggets.errors,
    };

    console.log("Orphan cleanup complete:", JSON.stringify(stats));
    return jsonRes(stats);
  } catch (err) {
    console.error("Cleanup error:", err);
    return jsonRes({ error: String(err) }, 500);
  }
});
