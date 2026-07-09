'use strict';

function normalizeSong(song = {}) {
  return {
    ...song,
    provider: 'netease',
    source: 'netease',
  };
}

function createNeteaseProvider({ api, getSession }) {
  if (!api || typeof getSession !== 'function') {
    throw new TypeError('createNeteaseProvider requires api and getSession');
  }

  const cookie = () => getSession()?.cookie || '';
  const session = () => getSession() || {};

  return {
    id: 'netease',
    name: '网易云音乐',
    implemented: true,
    planned: false,
    platform: 'windows-macos',
    capabilities: {
      search: true,
      playlists: true,
      liked: true,
      tracks: true,
      audioUrl: true,
      lyrics: true,
      song: true,
      mv: true,
      mvDetail: true,
      mvUrl: true,
      login: true,
    },
    sessionStatus() {
      const current = session();
      return current.cookie
        ? { loggedIn: true, uid: current.uid, nickname: current.nickname, provider: 'netease' }
        : { loggedIn: false, provider: 'netease' };
    },
    async playlists() {
      const current = session();
      if (!current.cookie || !current.uid) {
        const error = new Error('未登录');
        error.statusCode = 401;
        throw error;
      }
      const result = await api.user_playlist({ uid: current.uid, cookie: current.cookie });
      return result.body.playlist || [];
    },
    async liked() {
      const current = session();
      if (!current.cookie || !current.uid) {
        const error = new Error('未登录');
        error.statusCode = 401;
        throw error;
      }
      const likeRes = await api.likelist({ uid: current.uid, cookie: current.cookie });
      const ids = (likeRes.body.ids || []).slice(0, 200).join(',');
      if (!ids) return [];
      const detailRes = await api.song_detail({ ids, cookie: current.cookie });
      return (detailRes.body.songs || []).map(normalizeSong);
    },
    async tracks({ id }) {
      const current = session();
      if (!current.cookie) {
        const error = new Error('未登录');
        error.statusCode = 401;
        throw error;
      }
      const result = await api.playlist_track_all({ id, cookie: current.cookie });
      return (result.body.songs || []).map(normalizeSong);
    },
    async search({ keyword, limit = 20 }) {
      const result = await api.search({ keywords: keyword, limit: Number(limit), cookie: cookie() });
      return (result.body.result?.songs || []).map(normalizeSong);
    },
    async audioUrl({ id, level = 'standard' }) {
      const current = session();
      if (!current.cookie) {
        const error = new Error('未登录');
        error.statusCode = 401;
        throw error;
      }
      const result = await api.song_url_v1({ id, level, cookie: current.cookie });
      return result.body?.data?.[0] || null;
    },
    async lyrics({ id }) {
      const result = await api.lyric({ id, cookie: cookie() });
      return result.body;
    },
    async song({ id }) {
      const result = await api.song_detail({ ids: id, cookie: cookie() });
      const song = result.body.songs?.[0];
      return song ? normalizeSong(song) : null;
    },
    async mvDetail({ mvid }) {
      const result = await api.mv_detail({ mvid, cookie: cookie() });
      return result.body?.data;
    },
    async mvUrl({ id, quality }) {
      const result = await api.mv_url({ id, r: quality, cookie: cookie() });
      return result.body?.data?.url || '';
    },
  };
}

module.exports = {
  createNeteaseProvider,
  normalizeSong,
};
