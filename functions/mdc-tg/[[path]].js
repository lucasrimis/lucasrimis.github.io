// Cloudflare Pages Function: ponte entre o jogo Morada da Colina e o bot do Telegram do criador.
// Variáveis no painel do Cloudflare Pages (Settings > Variables and Secrets):
//   TG_TOKEN  (secreta) token do bot criado no @BotFather
//   TG_CHAT   o seu ID do Telegram (veja em /mdc-tg/setup depois de mandar "oi" para o bot)
// Rotas:
//   POST /mdc-tg/notify   {t:'join'|'chat', n, m, mode, r}  -> manda o aviso para o criador
//   GET  /mdc-tg/criador  -> últimas mensagens que o criador mandou para o bot (o jogo mostra no céu e no chat)
//   GET  /mdc-tg/setup    -> enquanto TG_CHAT não existe, lista quem mandou mensagem para o bot
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS } });
let memo = { t: 0, v: null };   // cache curtinho por instância, para não chamar o Telegram a cada jogador

export async function onRequest({ request: req, env }) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const url = new URL(req.url), path = url.pathname.replace(/^\/mdc-tg\/?/, '').replace(/\/$/, '');
  const T = env.TG_TOKEN; if (!T) return J({ ok: false, error: 'TG_TOKEN não configurado' }, 503);
  const api = (m, b) => fetch(`https://api.telegram.org/bot${T}/${m}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json()).catch(() => ({}));
  const owner = String(env.TG_CHAT || '').trim();

  if (path === 'setup') {
    if (owner) return J({ ok: true, msg: 'TG_CHAT já está configurado.' });
    const u = await api('getUpdates', { limit: 100 }), chats = {};
    for (const x of u.result || []) { const m = x.message; if (m && m.chat) chats[m.chat.id] = chats[m.chat.id] || [m.from && m.from.first_name, m.from && m.from.username && '@' + m.from.username].filter(Boolean).join(' '); }
    if (!u.ok) return J({ ok: false, telegram: u.description || 'sem resposta do Telegram' });
    if (!Object.keys(chats).length) return J({ ok: true, msg: 'O token funciona, mas ninguém mandou mensagem para o bot ainda. Mande um oi para ele e recarregue.' });
    return J({ ok: true, msg: 'Copie o número do seu nome e crie a variável TG_CHAT com ele.', chats });
  }

  if (path === 'notify' && req.method === 'POST') {
    if (!owner) return J({ ok: false }, 503);
    let b; try { b = JSON.parse(await req.text()); } catch (e) { return J({ ok: false }, 400); }
    const n = String(b.n || '?').replace(/\s+/g, ' ').slice(0, 24), m = String(b.m || '').slice(0, 200), r = String(b.r || '').replace(/[^A-Z]/g, '').slice(0, 6);
    let text;
    if (b.t === 'join') text = `🟢 ${n} entrou no jogo (${b.mode === 'online' ? 'online' : b.mode === 'sala' ? 'esconde-esconde, sala ' + r : 'sozinho'})`;
    else if (b.t === 'leave') text = `🔴 ${n} saiu do online${r ? ' (sala ' + r + ')' : ''}${b.why === 'fechou' ? ' — fechou o jogo' : b.why === 'sumiu' ? ' — fechou o app ou a conexão caiu' : ''}`;
    else if (b.t === 'chat' && m) text = `💬 ${r ? '[sala ' + r + '] ' : ''}${n}: ${m}`;
    else return J({ ok: false }, 400);
    await api('sendMessage', { chat_id: owner, text, disable_web_page_preview: true });
    return J({ ok: true });
  }

  if (path === 'criador') {
    const now = Math.floor(Date.now() / 1000);
    if (memo.v && Date.now() - memo.t < 4000) return J({ now, msgs: memo.v });
    let msgs = [];
    if (owner) {
      const u = await api('getUpdates', { limit: 100, allowed_updates: ['message'] }), res = u.result || [];
      // updates não confirmados ficam guardados 24 h; se acumular demais, confirma os antigos para os novos continuarem aparecendo
      if (res.length >= 80) await api('getUpdates', { offset: res[res.length - 30].update_id, limit: 1 });
      msgs = res.filter(x => x.message && String(x.message.chat.id) === owner && typeof x.message.text === 'string' && !x.message.text.startsWith('/'))
        .slice(-10).map(x => ({ id: x.update_id, d: x.message.date, m: x.message.text.slice(0, 200) }));
    }
    memo = { t: Date.now(), v: msgs };
    return J({ now, msgs });
  }
  return J({ ok: false, error: 'rota desconhecida' }, 404);
}
