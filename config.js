/* Fallback configuration for running the hub WITHOUT the backend — opened from
   disk, or served by any plain static server.

   With the backend running, server/index.js registers its own /config.js route
   ahead of the static handler and this file is never served. That route sets
   apiBase to "/api", which is what flips the hub out of demo mode.

   The guard below means whichever copy arrives first wins, so the order can
   never produce a half-configured page. */
window.ESH_CONFIG = window.ESH_CONFIG || { apiBase: null };
