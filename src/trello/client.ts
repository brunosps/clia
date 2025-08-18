import fetch from 'node-fetch';
import type { Config } from '../config.js';

export class TrelloClient {
  constructor(private cfg: Config['trello']) {}

  private base(path: string, qs: Record<string,string> = {}) {
    const u = new URL('https://api.trello.com/1' + path);
    u.searchParams.set('key', this.cfg.key);
    u.searchParams.set('token', this.cfg.token);
    for (const [k,v] of Object.entries(qs)) u.searchParams.set(k, v);
    return u.toString();
  }

  async getCard(cardId: string) {
    const url = this.base(`/cards/${cardId}`, { attachments: 'true', members: 'true' });
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Trello error ${r.status}`);
    return await r.json();
  }

  async moveCardToList(cardId: string, listId: string) {
    const url = this.base(`/cards/${cardId}`);
    const r = await fetch(url, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ idList: listId }) });
    if (!r.ok) throw new Error(`Trello move error ${r.status}`);
    return await r.json();
  }

  async getListsOnBoard(boardId: string) {
    const url = this.base(`/boards/${boardId}/lists`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Trello error ${r.status}`);
    return await r.json();
  }
}