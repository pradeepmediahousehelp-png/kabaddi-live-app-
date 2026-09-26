export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { match_id } = await request.json();

    // आख़िरी लॉग निकालें
    const lastLog = await env.DB.prepare(
      "SELECT * FROM raid_logs WHERE match_id = ? ORDER BY id DESC LIMIT 1"
    ).bind(match_id).first();

    if (!lastLog) {
      return Response.json({ error: "अनडू करने के लिए कोई पुराना एक्शन नहीं है" }, { status: 400 });
    }

    const prev = JSON.parse(lastLog.snapshot);

    // मैच की पुरानी स्थिति रीस्टोर करें
    await env.DB.prepare(`
      UPDATE matches 
      SET score_a = ?, score_b = ?, active_a = ?, active_b = ?, 
          empty_raids_a = ?, empty_raids_b = ?, raiding_team = ?, is_draid = ?
      WHERE id = ?
    `).bind(
      prev.score_a, prev.score_b, prev.active_a, prev.active_b,
      prev.empty_raids_a, prev.empty_raids_b, prev.raiding_team, prev.is_draid,
      match_id
    ).run();

    // लॉग डिलीट करें
    await env.DB.prepare("DELETE FROM raid_logs WHERE id = ?").bind(lastLog.id).run();

    return Response.json({ success: true, message: "पिछला एक्शन रीसेट हो गया" });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
