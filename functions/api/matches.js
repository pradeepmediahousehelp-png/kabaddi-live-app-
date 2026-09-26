export async function onRequestGet(context) {
  const { env } = context;
  try {
    const { results } = await env.DB.prepare(
      "SELECT * FROM matches ORDER BY created_at DESC"
    ).all();
    return Response.json(results);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const data = await request.json();
    const id = "M-" + Date.now();
    const teamA = data.team_a || "Team A";
    const teamB = data.team_b || "Team B";

    await env.DB.prepare(`
      INSERT INTO matches (id, team_a, team_b, score_a, score_b, active_a, active_b, raiding_team)
      VALUES (?, ?, ?, 0, 0, 7, 7, 'A')
    `).bind(id, teamA, teamB).run();

    return Response.json({ success: true, match_id: id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
