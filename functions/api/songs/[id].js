/**
 * PATCH /api/songs/:id - Update song metadata
 * DELETE /api/songs/:id - Delete song from R2 and D1
 * 
 * Bindings: MUSIC_BUCKET (R2), DB (D1)
 */

const PUBLIC_USER_ID = 'public_library';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function getUserId(request) {
  return PUBLIC_USER_ID;
}

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const origin = request.headers.get('Origin');

  try {
    const { id } = params;
    const userId = getUserId(request);
    if (!userId) {
      return new Response(JSON.stringify({ error: '缺少或非法的用户标识' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }
    const body = await request.json();

    // Check song exists
    const song = await env.DB.prepare(
      `SELECT id FROM songs WHERE id = ? AND user_id = ?`
    ).bind(id, userId).first();

    if (!song) {
      return new Response(JSON.stringify({ error: '歌曲不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];

    if (body.favorite !== undefined) {
      updates.push('favorite = ?');
      values.push(body.favorite ? 1 : 0);
    }
    if (body.last_position !== undefined) {
      updates.push('last_position = ?');
      values.push(body.last_position);
    }
    if (body.play_count !== undefined) {
      updates.push('play_count = ?');
      values.push(body.play_count);
    }
    if (body.duration !== undefined) {
      updates.push('duration = ?');
      values.push(body.duration);
    }

    if (updates.length === 0) {
      return new Response(JSON.stringify({ error: '没有需要更新的字段' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);
    values.push(userId);

    await env.DB.prepare(
      `UPDATE songs SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`
    ).bind(...values).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: '更新失败: ' + e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  }
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const origin = request.headers.get('Origin');

  try {
    const { id } = params;
    const userId = getUserId(request);
    if (!userId) {
      return new Response(JSON.stringify({ error: '缺少或非法的用户标识' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    // Find song to get r2_key
    const song = await env.DB.prepare(
      `SELECT id, r2_key FROM songs WHERE id = ? AND user_id = ?`
    ).bind(id, userId).first();

    if (!song) {
      return new Response(JSON.stringify({ error: '歌曲不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    // Delete from R2
    try {
      await env.MUSIC_BUCKET.delete(song.r2_key);
    } catch (e) {
      console.error('R2 delete error:', e);
    }

    // Delete from D1
    await env.DB.prepare(
      `DELETE FROM songs WHERE id = ? AND user_id = ?`
    ).bind(id, userId).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: '删除失败: ' + e.message }), {
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
