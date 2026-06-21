/**
 * GET /api/songs
 * List songs for the current anonymous user
 * 
 * Bindings: DB (D1)
 */

const PUBLIC_USER_ID = 'public_library';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function getUserId(request) {
  return PUBLIC_USER_ID;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const origin = request.headers.get('Origin');

  try {
    const userId = getUserId(request);

    const { results } = await env.DB.prepare(
      `SELECT id, name, type, size, duration, favorite, play_count, last_position, created_at, updated_at
       FROM songs
       WHERE user_id = ?
       ORDER BY created_at DESC`
    ).bind(userId).all();

    return new Response(JSON.stringify(results || []), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: '查询失败: ' + e.message }), {
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
