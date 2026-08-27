/* Deployment configuration.

   The hub talks to its own server; there is no offline build. This file is the
   one place to point it somewhere other than the default same-origin `/api` —
   useful if the API is ever split onto its own host.

   The running server registers its own /config.js route ahead of the static
   handler, so in a normal deployment this file is never served. It exists so
   that a static host in front of the API still gets a working page, and the
   guard below means whichever copy arrives first wins.

   Opened straight from disk, `/api` resolves to nothing, the first request
   fails, and the hub says it cannot reach its server. That is the honest
   answer: without the server there is no data, no session and no access
   control, so there is nothing to show. */
window.ESH_CONFIG = window.ESH_CONFIG || { apiBase: '/api' };
