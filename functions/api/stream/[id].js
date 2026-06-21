/**
 * GET /api/stream/:id
 * Stream audio file from R2
 * 
 * Bindings: MUSIC_BUCKET (R2), DB (D1)
 */

const CONTENT_TYPES = {
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav',
  'ogg': 'audio/ogg',
  'flac': 'audio/flac',
  'm4a': 'audio/mp4',
  'aac': 'audio/aac',
  'wma': 'audio/x-ms-wma',
};

function getContentType(type) {
  if (!type) return 'audio/mpeg';
  if (CONTENT_TYPES[type]) return CONTENT_TYPES[type];
  // Try extracting from mime type
  for (const [ext, mime] of Object.entries(CONTENT_TYPES)) {
    if (type.includes(ext)) return mime;
  }
  return type || 'audio/mpeg';
}

export async function onRequestGet(context) {
  const { env, params, request } = context;

  try {
    const { id } = params;

    // Query song from D1
    const song = await env.DB.prepare(
      `SELECT id, r2_key, type, name FROM songs WHERE id = ? AND user_id = 'demo-user'`
    ).bind(id).first();

    if (!song) {
      return new Response(JSON.stringify({ error: '歌曲不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get object from R2
    const object = await env.MUSIC_BUCKET.get(song.r2_key);

    if (!object) {
      return new Response(JSON.stringify({ error: '文件不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const contentType = getContentType(song.type);

    // Support Range requests for seeking
    const range = request.headers.get('Range');

    if (range) {
      const objectSize = object.size;
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : objectSize - 1;
      const chunkSize = end - start + 1;

      // Get the full array buffer and slice
      const fullBuffer = await object.arrayBuffer();
      const slice = fullBuffer.slice(start, end + 1);

      return new Response(slice, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Range': `bytes ${start}-${end}/${objectSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // Full response
    return new Response(object.body, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(object.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
        'Content-Disposition': `inline; filename="${encodeURIComponent(song.name)}"`,
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: '流式播放失败: ' + e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}