import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const serviceRoleKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || secretKeys.default;
const cloudinaryCloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME")!;
const cloudinaryApiKey = Deno.env.get("CLOUDINARY_API_KEY")!;
const cloudinaryApiSecret = Deno.env.get("CLOUDINARY_API_SECRET")!;
const cleanupSecret = Deno.env.get("SHORTS_CLEANUP_SECRET")!;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getCloudinaryPublicId(mediaUrl: string) {
  const url = new URL(mediaUrl);

  if (
    url.hostname !== "res.cloudinary.com" ||
    !url.pathname.includes("/video/upload/")
  ) {
    return null;
  }

  const uploadPath = url.pathname.split("/video/upload/")[1];

  if (!uploadPath) {
    return null;
  }

  const segments = uploadPath.split("/");
  const versionIndex = segments.findIndex((segment) => /^v\d+$/.test(segment));

  if (versionIndex >= 0) {
    segments.splice(0, versionIndex + 1);
  } else if (/^[a-z]{1,3}_[^/]+(?:,.*)?$/.test(segments[0])) {
    segments.shift();
  }

  const lastSegment = segments.at(-1);

  if (!lastSegment) {
    return null;
  }

  segments[segments.length - 1] = lastSegment.replace(/\.[^.]+$/, "");
  return segments.join("/");
}

function getSupabaseStoragePath(mediaUrl: string) {
  const marker = "/storage/v1/object/public/media/";
  const path = new URL(mediaUrl).pathname;
  const markerIndex = path.indexOf(marker);

  if (markerIndex < 0) {
    return null;
  }

  return decodeURIComponent(path.slice(markerIndex + marker.length));
}

async function signCloudinaryDestroy(publicId: string, timestamp: number) {
  const signatureInput =
    `invalidate=true&public_id=${publicId}&timestamp=${timestamp}${cloudinaryApiSecret}`;
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(signatureInput),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function deleteMedia(mediaUrl: string) {
  const cloudinaryPublicId = getCloudinaryPublicId(mediaUrl);

  if (cloudinaryPublicId) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signCloudinaryDestroy(
      cloudinaryPublicId,
      timestamp,
    );
    const body = new FormData();

    body.set("public_id", cloudinaryPublicId);
    body.set("timestamp", String(timestamp));
    body.set("api_key", cloudinaryApiKey);
    body.set("signature", signature);
    body.set("invalidate", "true");

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/video/destroy`,
      { method: "POST", body },
    );
    const result = await response.json();

    if (
      !response.ok ||
      !["ok", "not found"].includes(result.result)
    ) {
      throw new Error(
        result.error?.message || "Cloudinary asset deletion failed.",
      );
    }

    return;
  }

  const storagePath = getSupabaseStoragePath(mediaUrl);

  if (storagePath) {
    const { error } = await supabase.storage
      .from("media")
      .remove([storagePath]);

    if (error) {
      throw error;
    }

    return;
  }

  throw new Error("Short media URL is not from Cloudinary or Supabase Storage.");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  if (
    !cleanupSecret ||
    request.headers.get("x-cleanup-secret") !== cleanupSecret
  ) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: expiredPosts, error: readError } = await supabase
    .from("posts")
    .select("id,media_url")
    .eq("media_type", "short")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(100);

  if (readError) {
    console.error("Expired Shorts query failed:", readError);
    return jsonResponse({ error: "Could not query expired Shorts." }, 500);
  }

  let deleted = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (const post of expiredPosts || []) {
    try {
      if (post.media_url) {
        await deleteMedia(post.media_url);
      }

      const { error: commentsError } = await supabase
        .from("comments")
        .delete()
        .eq("post_id", post.id);

      if (commentsError) {
        throw commentsError;
      }

      const { error: likesError } = await supabase
        .from("likes")
        .delete()
        .eq("post_id", post.id);

      if (likesError) {
        throw likesError;
      }

      const { error: deleteError } = await supabase
        .from("posts")
        .delete()
        .eq("id", post.id)
        .eq("media_type", "short")
        .lt("created_at", cutoff);

      if (deleteError) {
        throw deleteError;
      }

      deleted += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Short cleanup failed for ${post.id}:`, message);
      failures.push({ id: post.id, error: message });
    }
  }

  return jsonResponse({
    cutoff,
    checked: expiredPosts?.length || 0,
    deleted,
    failures,
  });
});