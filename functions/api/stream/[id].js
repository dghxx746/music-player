/**
 * GET /api/stream/:id
 * Stream audio file from R2.
 *
 * Bindings: MUSIC_BUCKET (R2), DB (D1)
 */

const CONTENT_TYPES = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wma: 'audio/x-ms-wma',
};

const PUBLIC_USER_ID = 'public_library';

function getContentType(type) {
  if (!type) return 'audio/mpeg';
  if (CONTENT_TYPES[type]) return CONTENT_TYPES[type];
  for (const [ext, mime] of Object.entries(CONTENT_TYPES)) {
    if (type.includes(ext)) return mime;
  }
  return type || 'audio/mpeg';
}

function parseRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  let start;
  let end;

  if (rawStart === '') {
    const suffixLength = Number(rawEnd);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

function getUserId(request) {
  return PUBLIC_USER_ID;
}

export async function onRequestGet(context) {
  const { env, params, request } = context;

  try {
    const { id } = params;
    const userId = getUserId(request);
    if (!userId) {
      return new Response(JSON.stringify({ error: '缺少或非法的用户标识' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const song = await env.DB.prepare(
      `SELECT id, r2_key, type, name FROM songs WHERE id = ? AND user_id = ?`
    ).bind(id, userId).first();

    if (!song) {
      return new Response(JSON.stringify({ error: '歌曲不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const objectHead = await env.MUSIC_BUCKET.head(song.r2_key);

    if (!objectHead) {
      return new Response(JSON.stringify({ error: '文件不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const contentType = getContentType(song.type);
    const objectSize = objectHead.size;
    const range = request.headers.get('Range');

    if (range) {
      const parsedRange = parseRange(range, objectSize);

      if (!parsedRange) {
        return new Response(null, {
          status: 416,
          headers: {
            'Content-Range': `bytes */${objectSize}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }

      const { start, end } = parsedRange;
      const chunkSize = end - start + 1;
      const object = await env.MUSIC_BUCKET.get(song.r2_key, {
        range: { offset: start, length: chunkSize },
      });

      if (!object) {
        return new Response(JSON.stringify({ error: '文件不存在' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(object.body, {
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

    const object = await env.MUSIC_BUCKET.get(song.r2_key);

    if (!object) {
      return new Response(JSON.stringify({ error: '文件不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(objectSize),
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
