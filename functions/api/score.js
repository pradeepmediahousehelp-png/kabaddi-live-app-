export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { match_id, action, touch_points = 0, bonus = false } = body;

    // वर्तमान मैच डेटा फेच करें
    const match = await env.DB.prepare("SELECT * FROM matches WHERE id = ?").bind(match_id).first();
    if (!match) return Response.json({ error: "मैच नहीं मिला" }, { status: 404 });

    // पूर्व स्थिति का स्नैपशॉट सेव करें (Undo के लिए)
    const snapshot = JSON.stringify(match);

    let {
      score_a, score_b,
      active_a, active_b,
      empty_raids_a, empty_raids_b,
      raiding_team, is_draid
    } = match;

    const isA = raiding_team === 'A';
    let ptsRaider = 0;
    let ptsDefender = 0;
    let desc = "";

    // 1. रेड पॉइंट्स (Touch + Bonus)
    if (action === "raid_points") {
      let tPoints = parseInt(touch_points) || 0;
      let bPoint = bonus ? 1 : 0;

      // बोनस की आधिकारिक जाँच: कोर्ट में 6 या 7 डिफेंडर होने चाहिए
      const defActive = isA ? active_b : active_a;
      if (bonus && defActive < 6) {
        bPoint = 0; // 6 से कम पर बोनस नहीं मिलता
      }

      ptsRaider = tPoints + bPoint;

      if (isA) {
        score_a += ptsRaider;
        active_b = Math.max(0, active_b - tPoints);
        active_a = Math.min(7, active_a + tPoints); // रिवाइवल
        empty_raids_a = 0; // रेड में पॉइंट मिलते ही डू-ऑर-डाई काउंटर रीसेट
      } else {
        score_b += ptsRaider;
        active_a = Math.max(0, active_a - tPoints);
        active_b = Math.min(7, active_b + tPoints);
        empty_raids_b = 0;
      }
      desc = `रेड पॉइंट: +${ptsRaider} (${tPoints} टच ${bPoint ? '+ बोनस' : ''})`;
    }

    // 2. टैकल (Super Tackle शामिल)
    else if (action === "tackle") {
      const defActive = isA ? active_b : active_a;
      const isSuperTackle = defActive <= 3;
      ptsDefender = isSuperTackle ? 2 : 1;

      if (isA) {
        score_b += ptsDefender;
        active_a = Math.max(0, active_a - 1); // रेडर आउट
        active_b = Math.min(7, active_b + 1); // डिफेंडर रिवाइव
        empty_raids_a = 0;
      } else {
        score_a += ptsDefender;
        active_b = Math.max(0, active_b - 1);
        active_a = Math.min(7, active_a + 1);
        empty_raids_b = 0;
      }
      desc = isSuperTackle ? "सुपर टैकल! (+2)" : "सफल टैकल (+1)";
    }

    // 3. खाली रेड (Empty Raid & Do-or-Die Logic)
    else if (action === "empty") {
      if (isA) {
        if (is_draid) {
          // डू-ऑर-डाई में खाली रेड = रेडर आउट, विरोधी को 1 पॉइंट
          score_b += 1;
          active_a = Math.max(0, active_a - 1);
          active_b = Math.min(7, active_b + 1);
          empty_raids_a = 0;
          desc = "डू-ऑर-डाई असफल! रेडर आउट (+1 Team B)";
        } else {
          empty_raids_a += 1;
          desc = "खाली रेड";
        }
      } else {
        if (is_draid) {
          score_a += 1;
          active_b = Math.max(0, active_b - 1);
          active_a = Math.min(7, active_a + 1);
          empty_raids_b = 0;
          desc = "डू-ऑर-डाई असफल! रेडर आउट (+1 Team A)";
        } else {
          empty_raids_b += 1;
          desc = "खाली रेड";
        }
      }
    }

    // 4. ऑल-आउट (लोना) चेक
    if (active_a === 0) {
      score_b += 2; // ऑल-आउट के +2 पॉइंट्स
      active_a = 7; // पूरी टीम वापस कोर्ट पर
      desc += " | Team A ऑल-आउट! (+2 लोना Team B)";
    }
    if (active_b === 0) {
      score_a += 2;
      active_b = 7;
      desc += " | Team B ऑल-आउट! (+2 लोना Team A)";
    }

    // अगली रेड का टर्न और डू-ऑर-डाई स्टेटस सेट करना
    const nextRaidingTeam = isA ? 'B' : 'A';
    const nextEmptyCount = nextRaidingTeam === 'A' ? empty_raids_a : empty_raids_b;
    const nextIsDraid = nextEmptyCount >= 2 ? 1 : 0;

    // डेटाबेस अपडेट
    await env.DB.prepare(`
      UPDATE matches 
      SET score_a = ?, score_b = ?, active_a = ?, active_b = ?, 
          empty_raids_a = ?, empty_raids_b = ?, raiding_team = ?, is_draid = ?
      WHERE id = ?
    `).bind(
      score_a, score_b, active_a, active_b,
      empty_raids_a, empty_raids_b, nextRaidingTeam, nextIsDraid,
      match_id
    ).run();

    // हिस्ट्री लॉग इंसर्ट करें (Undo के लिए)
    await env.DB.prepare(`
      INSERT INTO raid_logs (match_id, raiding_team, action_type, points_a, points_b, description, snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(match_id, raiding_team, action, isA ? ptsRaider : ptsDefender, isA ? ptsDefender : ptsRaider, desc, snapshot).run();

    return Response.json({ success: true, message: desc });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
