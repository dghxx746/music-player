/**
 * POST /api/upload
 * Upload a music file to R2 and save metadata to D1
 * 
 * Bindings: MUSIC_BUCKET (R2), DB (D1)
 */

const ALLOWED_TYPES = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/x-ms-wma': 'wma',
};

const ALLOWED_EXTENSIONS = /\.(mp3|wav|ogg|flac|m4a|aac|wma)$/i;

function generateUUID() {
  return crypto.randomUUID();
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin');

  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return new Response(JSON.stringify({ error: '未找到文件' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    // Validate file type
    const fileType = file.type || '';
    const fileName = file.name || 'unknown';
    const isAllowedType = ALLOWED_TYPES[fileType] || ALLOWED_EXTENSIONS.test(fileName);

    if (!isAllowedType) {
      return new Response(JSON.stringify({ error: '不支持的文件格式，仅支持 MP3/WAV/OGG/FLAC' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    const userId = 'demo-user';
    const id = generateUUID();
    const name = fileName.replace(/\.[^/.]+$/, '');
    const type = fileType || 'audio/unknown';
    const size = file.size;

    // Upload to R2
    const r2Key = `users/${userId}/songs/${id}-${fileName}`;
    const arrayBuffer = await file.arrayBuffer();
    await env.MUSIC_BUCKET.put(r2Key, arrayBuffer, {
      httpMetadata: {
        contentType: type,
      },
      customMetadata: {
        userId,
        originalName: fileName,
        songId: id,
      },
    });

    // Insert metadata into D1
    await env.DB.prepare(
      `INSERT INTO songs (id, user_id, name, type, size, r2_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(id, userId, name, type, size, r2Key).run();

    return new Response(JSON.stringify({
      id,
      name,
      type,
      size,
      r2Key,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: '上传失败: ' + e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  }
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin');
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}