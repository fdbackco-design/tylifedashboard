/**
 * 푸시 알림 탭 → 공지 상세 이동 (React 마운트 전에 동작).
 * Service Worker postMessage 유실·iOS PWA 포커스만 되는 경우 Cache API 대기 경로로 보완.
 */
(function () {
  var MSG_TYPE = 'PUSH_NOTIFICATION_NAVIGATE';
  var BC_NAME = 'tylife-push-navigate';
  var CACHE_NAME = 'tylife-push-nav-v1';
  var CACHE_KEY = 'https://tylife.local/pending-push-nav';
  var PENDING_KEY = 'tylife_pending_push_nav';

  function normalize(url) {
    try {
      if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) {
        var u = new URL(url);
        return u.pathname + u.search + u.hash;
      }
    } catch (e) {
      /* ignore */
    }
    return url.charAt(0) === '/' ? url : '/' + url;
  }

  function go(url) {
    var path = normalize(url);
    var current = location.pathname + location.search + location.hash;
    if (current === path) {
      try {
        sessionStorage.removeItem(PENDING_KEY);
      } catch (e) {
        /* ignore */
      }
      return;
    }
    try {
      sessionStorage.setItem(PENDING_KEY, path);
    } catch (e) {
      /* ignore */
    }
    location.assign(path);
  }

  function onMsg(data) {
    if (!data || data.type !== MSG_TYPE || !data.url) return;
    go(data.url);
  }

  window.addEventListener('message', function (e) {
    onMsg(e.data);
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (e) {
      onMsg(e.data);
    });
    navigator.serviceWorker.register('/sw.js').catch(function () {
      /* ignore */
    });
    try {
      var bc = new BroadcastChannel(BC_NAME);
      bc.onmessage = function (e) {
        onMsg(e.data);
      };
    } catch (e) {
      /* ignore */
    }
  }

  function drain() {
    try {
      var pending = sessionStorage.getItem(PENDING_KEY);
      if (pending) {
        go(pending);
        return;
      }
    } catch (e) {
      /* ignore */
    }
    if (!('caches' in window)) return;
    caches
      .open(CACHE_NAME)
      .then(function (cache) {
        return cache.match(CACHE_KEY);
      })
      .then(function (res) {
        if (!res) return null;
        return res.text().then(function (text) {
          return { text: text };
        });
      })
      .then(function (payload) {
        if (!payload || !payload.text) return;
        var path = payload.text.trim();
        if (!path) return;
        return caches.open(CACHE_NAME).then(function (cache) {
          return cache.delete(CACHE_KEY).then(function () {
            go(path);
          });
        });
      })
      .catch(function () {
        /* ignore */
      });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') drain();
  });
  window.addEventListener('pageshow', drain);
  window.addEventListener('focus', drain);
  drain();
})();
