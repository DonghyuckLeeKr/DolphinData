import { handleRequest } from './handler.js';

// D1-backed storage for the intake handler. Rows are deleted once the operator's PC
// has imported them, and rate-limit rows older than a day are pruned on each write.
class D1Store {
  constructor(db) { this.db = db; }

  async findByReportId(reportId) {
    const row = await this.db.prepare('SELECT receipt_id, digest, received_at FROM reports WHERE report_id = ?').bind(reportId).first();
    return row ? { receiptId: row.receipt_id, digest: row.digest, receivedAt: row.received_at } : null;
  }

  async countPending() {
    return (await this.db.prepare('SELECT COUNT(*) AS n FROM reports').first()).n;
  }

  async recentSubmissions(client, since) {
    return (await this.db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE client = ? AND at >= ?').bind(client, since).first()).n;
  }

  async insert({ receiptId, reportId, body, digest, receivedAt, client, at }) {
    await this.db.batch([
      this.db.prepare('INSERT INTO reports (receipt_id, report_id, body, digest, received_at) VALUES (?, ?, ?, ?, ?)')
        .bind(receiptId, reportId, body, digest, receivedAt),
      this.db.prepare('INSERT INTO submissions (client, at) VALUES (?, ?)').bind(client, at),
      this.db.prepare('DELETE FROM submissions WHERE at < ?').bind(at - 24 * 60 * 60 * 1000)
    ]);
  }

  async listPending(limit) {
    const { results } = await this.db.prepare('SELECT receipt_id, received_at, body FROM reports ORDER BY received_at LIMIT ?').bind(limit).all();
    return results.map(row => ({ receiptId: row.receipt_id, receivedAt: row.received_at, body: row.body }));
  }

  async remove(receiptId) {
    await this.db.prepare('DELETE FROM reports WHERE receipt_id = ?').bind(receiptId).run();
  }
}

// Optional Discord webhook so the operator hears about a report even while the PC is off.
// It carries no report content: descriptions stay private until the PC imports them.
const notifier = env => async () => {
  if (!env.DISCORD_WEBHOOK_URL) return;
  await fetch(env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '새 문제 신고가 접수되어 대기 중입니다. PC 자동화가 실행되면 가져옵니다.', allowed_mentions: { parse: [] } })
  });
};

export default {
  async fetch(request, env, ctx) {
    const notify = notifier(env);
    return handleRequest(request, env, {
      store: new D1Store(env.DB),
      notify: () => { ctx.waitUntil(notify().catch(() => {})); return Promise.resolve(); }
    });
  }
};
